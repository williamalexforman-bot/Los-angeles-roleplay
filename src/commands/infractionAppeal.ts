import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type Message,
    type MessageCreateOptions,
} from 'discord.js';
import { BRAND, INFRACTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { Infraction, InfractionAppeal, type InfractionAppealRecord } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { getInfractionByThreadIdPublic, recoverInfractionByThreadId, type InfractionRecord } from './staffManagement';
import { logger } from '../utils/logger';

const INFRACTION_APPEAL_CHANNEL_ID = process.env.INFRACTION_APPEAL_CHANNEL_ID || '1537227443423682612';
const APPEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

let cachedClient: Client | null = null;
const inMemoryAppeals = new Map<string, InfractionAppealRecord>();

export function setInfractionAppealClient(client: Client): void {
    cachedClient = client;
}

function generateAppealId(): string {
    return `IA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function clean(value: string, max = 1_500): string {
    const normalized = value.replace(/\r/g, '').trim();
    if (!normalized) return 'Not provided.';
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function configuredReviewerRoleIds(): string[] {
    return Array.from(new Set([
        INFRACTION_AUTHORIZED_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
        ...(process.env.INFRACTION_AUTHORIZED_ROLE_IDS || '').split(','),
    ].map(value => value?.trim()).filter((value): value is string => Boolean(value))));
}

function roleIdsFromMember(member: unknown): string[] {
    if (!member || typeof member !== 'object' || !('roles' in member)) return [];
    const roles = (member as { roles?: unknown }).roles;
    if (Array.isArray(roles)) return roles.filter((role): role is string => typeof role === 'string');
    if (roles && typeof roles === 'object' && 'cache' in roles) {
        const cache = (roles as { cache?: { keys?: () => IterableIterator<string> } }).cache;
        if (cache?.keys) return Array.from(cache.keys());
    }
    return [];
}

async function canReviewAppeal(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.guildId) return false;
    if (interaction.guild?.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const requiredRoles = configuredReviewerRoleIds();
    if (roleIdsFromMember(interaction.member).some(roleId => requiredRoles.includes(roleId))) return true;
    try {
        const member = await interaction.guild?.members.fetch(interaction.user.id);
        return roleIdsFromMember(member).some(roleId => requiredRoles.includes(roleId));
    } catch {
        return false;
    }
}

function appealDeadlineMs(record: InfractionRecord): number {
    const issuedAt = new Date(record.createdAt).getTime();
    return Number.isFinite(issuedAt) ? issuedAt + APPEAL_WINDOW_MS : 0;
}

function appealWindowOpen(record: InfractionRecord): boolean {
    const deadline = appealDeadlineMs(record);
    return deadline > 0 && Date.now() < deadline;
}

function appealWindowClosedMessage(record: InfractionRecord): string {
    const deadline = appealDeadlineMs(record);
    return deadline > 0
        ? `The 24-hour appeal window for this infraction has expired. The deadline was <t:${Math.floor(deadline / 1000)}:F>.`
        : 'The 24-hour appeal window for this infraction has expired.';
}

async function loadInfractionForAppeal(
    client: Client,
    key: string,
    guildId?: string,
): Promise<InfractionRecord | null> {
    let record = await getInfractionByThreadIdPublic(key).catch(() => null);
    if (!record) record = await recoverInfractionByThreadId(client, key, guildId).catch(() => null);
    if (record || !isDatabaseAvailable()) return record;

    const databaseRecord = await Infraction.findOne({
        $or: [{ threadId: key }, { caseNumber: key }, { detailMessageId: key }],
    }).lean().exec().catch(() => null) as unknown as {
        appealable?: boolean;
        action?: string;
        reason?: string;
        ruleBroken?: string;
        caseNumber?: string;
        guildId?: string;
        memberId?: string;
        memberUsername?: string;
        issuedById?: string;
        status?: string;
        parentChannelId?: string;
        headerMessageId?: string;
        threadId?: string;
        detailMessageId?: string;
        createdAt?: Date;
        updatedAt?: Date;
    } | null;
    if (!databaseRecord) return null;

    const createdAt = databaseRecord.createdAt?.toISOString() || new Date().toISOString();
    return {
        caseNumber: databaseRecord.caseNumber || key,
        guildId: databaseRecord.guildId || guildId || '',
        memberId: databaseRecord.memberId || '',
        memberUsername: databaseRecord.memberUsername || '',
        issuedById: databaseRecord.issuedById || '',
        action: (databaseRecord.action || 'Warning') as InfractionRecord['action'],
        reason: databaseRecord.reason || 'No reason provided.',
        ruleBroken: databaseRecord.ruleBroken || databaseRecord.reason || 'No notes supplied.',
        evidence: 'No evidence supplied.',
        internalNotes: 'No internal notes supplied.',
        notifyMember: true,
        appealable: databaseRecord.appealable === undefined ? true : databaseRecord.appealable,
        expiration: 'No expiration set.',
        status: (databaseRecord.status || 'Active') as InfractionRecord['status'],
        parentChannelId: databaseRecord.parentChannelId || '',
        headerMessageId: databaseRecord.headerMessageId || '',
        threadId: databaseRecord.threadId || key,
        detailMessageId: databaseRecord.detailMessageId || '',
        createdAt,
        updatedAt: databaseRecord.updatedAt?.toISOString() || createdAt,
        history: [],
    };
}

function componentText(message: Message): string {
    const output: string[] = [];

    const walk = (value: unknown): void => {
        if (!value) return;
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (typeof value !== 'object') return;

        const maybeBuilder = value as { toJSON?: () => unknown };
        if (typeof maybeBuilder.toJSON === 'function') {
            walk(maybeBuilder.toJSON());
            return;
        }

        const node = value as { content?: unknown; components?: unknown };
        if (typeof node.content === 'string') output.push(node.content);
        if (node.components) walk(node.components);
    };

    walk(message.components);
    for (const embed of message.embeds) {
        if (embed.title) output.push(embed.title);
        if (embed.description) output.push(embed.description);
        for (const field of embed.fields) output.push(`**${field.name}**\n${field.value}`);
    }
    return output.join('\n');
}

function extractField(text: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\*\\*${escaped}:?\\*\\*\\s*\\n?([^\\n]+)`, 'i'),
        new RegExp(`>?\\s*\\*\\*${escaped}:?\\*\\*\\s*([^\\n]+)`, 'i'),
    ];
    for (const pattern of patterns) {
        const value = text.match(pattern)?.[1]?.trim();
        if (value) return value.replace(/^`|`$/g, '').trim();
    }
    return '';
}

function findDiscordUrl(text: string): string {
    return text.match(/https:\/\/discord\.com\/channels\/\d+\/\d+(?:\/\d+)?/i)?.[0] || '';
}

function idsFromDiscordUrl(url: string): string[] {
    if (!url) return [];
    const match = url.match(/\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/i);
    if (!match) return [];
    return [match[3], match[2]].filter((value): value is string => Boolean(value));
}

async function reconstructAppealFromReviewMessage(
    client: Client,
    message: Message,
    appealId: string,
): Promise<InfractionAppealRecord | null> {
    const text = componentText(message);
    if (!text.includes(appealId)) return null;

    const userId = text.match(/<@!?(\d{17,20})>/)?.[1];
    if (!userId) return null;

    const infractionLink = findDiscordUrl(text);
    let sourceRecord: InfractionRecord | null = null;
    for (const key of idsFromDiscordUrl(infractionLink)) {
        sourceRecord = await loadInfractionForAppeal(client, key, message.guildId || undefined).catch(() => null);
        if (sourceRecord) break;
    }

    const rawStatus = extractField(text, 'Status').toLowerCase();
    const status: InfractionAppealRecord['status'] = rawStatus.includes('approved')
        ? 'Approved'
        : rawStatus.includes('denied')
            ? 'Denied'
            : 'Pending';

    const record: InfractionAppealRecord = {
        appealId,
        guildId: sourceRecord?.guildId || message.guildId || '',
        infractionThreadId: sourceRecord?.threadId || idsFromDiscordUrl(infractionLink)[0] || '',
        infractionCaseNumber: sourceRecord?.caseNumber || extractField(text, 'Infraction') || 'Unknown Infraction',
        infractionLink,
        userId,
        username: extractField(text, 'Discord Username') || userId,
        discordUsername: extractField(text, 'Discord Username') || userId,
        robloxUsername: extractField(text, 'Roblox Username') || 'Unknown',
        appealReason: extractField(text, 'Appeal Reason') || 'Recovered from Discord review message.',
        willRepeat: extractField(text, 'Will Do Again?') || extractField(text, 'Will Do Again') || 'NO',
        status,
        reviewMessageId: message.id,
        reviewChannelId: message.channelId,
        createdAt: message.createdAt,
        updatedAt: message.editedAt || message.createdAt,
    };
    inMemoryAppeals.set(appealId, record);
    return record;
}

function messageContainsAppealId(message: Message, appealId: string): boolean {
    if (componentText(message).includes(appealId)) return true;
    const serialized = JSON.stringify(message.components.map(component => component.toJSON()));
    return serialized.includes(appealId);
}

async function recoverAppealFromReviewChannel(client: Client, appealId: string): Promise<InfractionAppealRecord | null> {
    const channel = await client.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return null;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return null;
    for (const message of messages.values()) {
        if (!messageContainsAppealId(message, appealId)) continue;
        const recovered = await reconstructAppealFromReviewMessage(client, message, appealId);
        if (recovered) return recovered;
    }
    return null;
}

async function loadAppeal(appealId: string, client?: Client): Promise<InfractionAppealRecord | null> {
    const memoryRecord = inMemoryAppeals.get(appealId);
    if (memoryRecord) return memoryRecord;

    if (isDatabaseAvailable()) {
        const databaseRecord = await InfractionAppeal.findOne({ appealId }).lean().exec().catch(() => null);
        if (databaseRecord) {
            const normalized = databaseRecord as unknown as InfractionAppealRecord;
            inMemoryAppeals.set(appealId, normalized);
            return normalized;
        }
    }

    return client ? recoverAppealFromReviewChannel(client, appealId) : null;
}

async function findExistingAppeal(
    client: Client,
    infraction: InfractionRecord,
    userId: string,
): Promise<InfractionAppealRecord | null> {
    for (const record of inMemoryAppeals.values()) {
        if (record.userId === userId && record.infractionCaseNumber === infraction.caseNumber) return record;
    }

    if (isDatabaseAvailable()) {
        const databaseRecord = await InfractionAppeal.findOne({
            userId,
            infractionCaseNumber: infraction.caseNumber,
        }).sort({ createdAt: -1 }).lean().exec().catch(() => null);
        if (databaseRecord) {
            const normalized = databaseRecord as unknown as InfractionAppealRecord;
            inMemoryAppeals.set(normalized.appealId, normalized);
            return normalized;
        }
    }

    const channel = await client.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return null;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return null;

    for (const message of messages.values()) {
        const text = componentText(message);
        if (!text.includes(`<@${userId}>`) && !text.includes(`<@!${userId}>`)) continue;
        const link = findDiscordUrl(text);
        const keys = idsFromDiscordUrl(link);
        const sameInfraction = text.includes(infraction.caseNumber)
            || keys.includes(infraction.threadId)
            || keys.includes(infraction.detailMessageId)
            || keys.includes(infraction.parentChannelId);
        if (!sameInfraction) continue;
        const appealId = text.match(/IA-[A-Z0-9-]+/i)?.[0];
        if (!appealId) continue;
        const recovered = await reconstructAppealFromReviewMessage(client, message, appealId);
        if (recovered) return recovered;
    }
    return null;
}

function existingAppealMessage(record: InfractionAppealRecord): string {
    if (record.status === 'Denied') {
        return `Your appeal **${record.appealId}** was denied. You only receive one appeal attempt for each infraction, so this infraction cannot be appealed again.`;
    }
    if (record.status === 'Approved') {
        return `Your appeal **${record.appealId}** was already approved. This infraction cannot be appealed again.`;
    }
    return `You already have a pending appeal (**${record.appealId}**) for this infraction. You cannot submit another appeal.`;
}

function reviewButtons(appealId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`infraction-appeal:approve:${appealId}`)
            .setLabel('Approve')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`infraction-appeal:deny:${appealId}`)
            .setLabel('Deny')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger),
    );
}

function buildReviewPanel(
    record: InfractionAppealRecord,
    review?: { status: 'Approved' | 'Denied'; reviewedById: string; reason: string },
): ContainerBuilder {
    const status = review?.status || record.status;
    const color = status === 'Approved' ? 0x22c55e : status === 'Denied' ? 0xef4444 : BRAND.color;
    const submitted = Math.floor(new Date(record.createdAt).getTime() / 1000);
    const body = [
        '## ⚖️ Infraction Appeal',
        '> A staff infraction appeal has been submitted for review.',
        '',
        `> **Appeal ID:** \`${record.appealId}\``,
        `> **Discord User:** <@${record.userId}>`,
        `> **Discord Username:** \`${clean(record.discordUsername, 100)}\``,
        `> **Roblox Username:** \`${clean(record.robloxUsername, 100)}\``,
        `> **Infraction:** [${clean(record.infractionCaseNumber, 80)}](${record.infractionLink})`,
        `> **Appeal Reason:** ${clean(record.appealReason, 1_000)}`,
        `> **Will Do Again?:** \`${clean(record.willRepeat, 20)}\``,
        `> **Status:** \`${status}\``,
        Number.isFinite(submitted) ? `> **Submitted:** <t:${submitted}:F>` : '',
    ].filter(Boolean);

    if (review) {
        body.push(
            '',
            `> **Reviewed By:** <@${review.reviewedById}>`,
            `> **Review Reason:** ${clean(review.reason, 1_000)}`,
        );
    }

    const panel = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body.join('\n')));

    panel.addSeparatorComponents(separator());
    if (!review && status === 'Pending') {
        panel.addActionRowComponents(reviewButtons(record.appealId));
    } else {
        panel.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`infraction-appeal:resolved:${record.appealId}`)
                    .setLabel(status === 'Approved' ? 'Appeal Approved' : 'Appeal Denied')
                    .setEmoji(status === 'Approved' ? '✅' : '❌')
                    .setStyle(status === 'Approved' ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setDisabled(true),
            ),
        );
    }
    return panel;
}

function buildResultPanel(
    record: InfractionAppealRecord,
    approved: boolean,
    reviewedById: string,
    reason: string,
): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(approved ? 0x22c55e : 0xef4444)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                `## ${approved ? '✅ Infraction Appeal Approved' : '❌ Infraction Appeal Denied'}`,
                approved
                    ? '> Your infraction appeal has been approved.'
                    : '> Your infraction appeal has been denied. You cannot submit another appeal for this infraction.',
                '',
                `> **Appeal ID:** \`${record.appealId}\``,
                `> **Infraction:** \`${clean(record.infractionCaseNumber, 80)}\``,
                `> **Reason:** ${clean(reason, 1_000)}`,
                `> **Reviewed By:** <@${reviewedById}>`,
            ].join('\n')),
        );
}

function appealFormModal(threadId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction-appeal:form:${threadId}`)
        .setTitle('Infraction Appeal Form')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('discord-username')
                    .setLabel('1. Discord Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('roblox-username')
                    .setLabel('2. Roblox Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('appeal-reason')
                    .setLabel('3. Appeal reason (2+ sentences)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('will-repeat')
                    .setLabel('4. Will you do this again? (YES or NO)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(10),
            ),
        );
}

function reviewReasonModal(appealId: string, action: 'approve' | 'deny'): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction-appeal:${action}-modal:${appealId}`)
        .setTitle(action === 'approve' ? 'Approve Infraction Appeal' : 'Deny Infraction Appeal')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('review-reason')
                    .setLabel(action === 'approve' ? 'Reason for approval' : 'Reason for denial')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
        );
}

export function infractionAppealButton(threadId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`infraction-appeal:start:${threadId}`)
            .setLabel('Appeal Infraction')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚖️'),
    );
}

async function postApprovedAppealNotice(
    client: Client,
    record: InfractionAppealRecord,
    reviewedById: string,
    reviewReason: string,
): Promise<boolean> {
    const panel = new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                '## ✅ Infraction Appeal Approved',
                `> Infraction **${clean(record.infractionCaseNumber, 80)}** was successfully appealed.`,
                '',
                `> **Member:** <@${record.userId}>`,
                `> **Appeal ID:** \`${record.appealId}\``,
                `> **Approved By:** <@${reviewedById}>`,
                `> **Reason:** ${clean(reviewReason, 1_000)}`,
            ].join('\n')),
        );
    const payload: MessageCreateOptions = {
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] as [] },
    };

    const source = await client.channels.fetch(record.infractionThreadId).catch(() => null);
    if (!source) return false;
    if (source.isThread()) {
        if (source.archived && !source.locked) {
            await source.setArchived(false, `${record.appealId} approved`).catch(() => null);
        }
        if (source.isSendable() && await source.send(payload).then(() => true).catch(() => false)) return true;
        const parent = source.parent || (source.parentId
            ? await client.channels.fetch(source.parentId).catch(() => null)
            : null);
        return parent?.isSendable() ? parent.send(payload).then(() => true).catch(() => false) : false;
    }
    return source.isSendable() ? source.send(payload).then(() => true).catch(() => false) : false;
}

export async function handleInfractionAppealButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, key] = interaction.customId.split(':');

    if (action === 'resolved') {
        await interaction.reply({ content: 'This appeal has already been reviewed.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'start' && key) {
        const record = await loadInfractionForAppeal(interaction.client, key, interaction.guildId || undefined);
        if (!record) {
            await interaction.reply({ content: 'This infraction record could not be loaded.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!record.appealable) {
            await interaction.reply({ content: 'This infraction is not marked as appealable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!appealWindowOpen(record)) {
            await interaction.reply({ content: appealWindowClosedMessage(record), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (record.memberId && record.memberId !== interaction.user.id) {
            await interaction.reply({ content: 'Only the member who received this infraction can appeal it.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const existing = await findExistingAppeal(interaction.client, record, interaction.user.id);
        if (existing) {
            await interaction.reply({ content: existingAppealMessage(existing), flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(appealFormModal(key));
        return true;
    }

    if ((action === 'approve' || action === 'deny') && key) {
        if (!(await canReviewAppeal(interaction))) {
            await interaction.reply({ content: 'You do not have permission to review infraction appeals.', flags: MessageFlags.Ephemeral });
            return true;
        }

        let appeal = await loadAppeal(key, interaction.client);
        if (!appeal) {
            appeal = await reconstructAppealFromReviewMessage(interaction.client, interaction.message, key);
        }
        if (!appeal) {
            await interaction.reply({
                content: 'I could not recover this appeal from the review message. Please contact an administrator.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        if (appeal.status !== 'Pending') {
            await interaction.reply({ content: `This appeal has already been ${appeal.status.toLowerCase()}.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(reviewReasonModal(key, action));
        return true;
    }

    return false;
}

export async function handleInfractionAppealModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, key] = interaction.customId.split(':');
    if (!key) return false;

    if (action === 'form') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const discordUsername = interaction.fields.getTextInputValue('discord-username').trim();
        const robloxUsername = interaction.fields.getTextInputValue('roblox-username').trim();
        const appealReason = interaction.fields.getTextInputValue('appeal-reason').trim();
        const willRepeat = interaction.fields.getTextInputValue('will-repeat').trim().toUpperCase();

        const sentenceCount = (appealReason.match(/[.!?]+/g) || []).length;
        if (sentenceCount < 2) {
            await interaction.editReply('Your appeal reason must be **2+ sentences** with details. Please try again.');
            return true;
        }
        if (willRepeat !== 'YES' && willRepeat !== 'NO') {
            await interaction.editReply('Please answer the "Will you do this again?" question with **YES** or **NO**.');
            return true;
        }

        const client = cachedClient || interaction.client;
        const sourceRecord = await loadInfractionForAppeal(client, key, interaction.guildId || undefined);
        if (!sourceRecord) {
            await interaction.editReply('This infraction record could not be loaded. Please open the original infraction and try again.');
            return true;
        }
        if (!sourceRecord.appealable) {
            await interaction.editReply('This infraction is not marked as appealable.');
            return true;
        }
        if (!appealWindowOpen(sourceRecord)) {
            await interaction.editReply(appealWindowClosedMessage(sourceRecord));
            return true;
        }
        if (sourceRecord.memberId && sourceRecord.memberId !== interaction.user.id) {
            await interaction.editReply('Only the member who received this infraction can appeal it.');
            return true;
        }

        const existing = await findExistingAppeal(client, sourceRecord, interaction.user.id);
        if (existing) {
            await interaction.editReply(existingAppealMessage(existing));
            return true;
        }

        const infractionSource = await client.channels.fetch(sourceRecord.threadId).catch(() => null);
        const infractionLink = infractionSource?.isThread()
            ? infractionSource.url
            : sourceRecord.parentChannelId && sourceRecord.detailMessageId
                ? `https://discord.com/channels/${sourceRecord.guildId}/${sourceRecord.parentChannelId}/${sourceRecord.detailMessageId}`
                : `https://discord.com/channels/${sourceRecord.guildId || interaction.guildId}/${sourceRecord.threadId}`;
        const noticeChannelId = infractionSource?.isThread()
            ? infractionSource.id
            : sourceRecord.parentChannelId || sourceRecord.threadId;

        const appealId = generateAppealId();
        const now = new Date();
        const appealRecord: InfractionAppealRecord = {
            appealId,
            guildId: sourceRecord.guildId || interaction.guildId || '',
            infractionThreadId: noticeChannelId,
            infractionCaseNumber: sourceRecord.caseNumber,
            infractionLink,
            userId: interaction.user.id,
            username: interaction.user.username,
            discordUsername,
            robloxUsername,
            appealReason,
            willRepeat,
            status: 'Pending',
            reviewMessageId: '',
            reviewChannelId: INFRACTION_APPEAL_CHANNEL_ID,
            createdAt: now,
            updatedAt: now,
        };

        const channel = await client.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply('The appeal review channel is unavailable. Please contact staff.');
            return true;
        }

        const reviewMessage = await channel.send({
            components: [buildReviewPanel(appealRecord)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        appealRecord.reviewMessageId = reviewMessage.id;
        inMemoryAppeals.set(appealId, appealRecord);

        if (isDatabaseAvailable()) {
            await InfractionAppeal.create(appealRecord).catch(error => {
                logger.warn(`[InfractionAppeal] ${appealId} is available in memory, but database persistence failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            });
        }

        await interaction.editReply(`Your infraction appeal **${appealId}** has been submitted. You have used your one appeal attempt for this infraction and will receive a DM with the result.`);
        return true;
    }

    if ((action === 'approve-modal' || action === 'deny-modal') && key) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await canReviewAppeal(interaction))) {
            await interaction.editReply('You do not have permission to review infraction appeals.');
            return true;
        }

        const reviewReason = interaction.fields.getTextInputValue('review-reason').trim();
        const isApproved = action === 'approve-modal';
        const appealId = key;
        const record = await loadAppeal(appealId, interaction.client);
        if (!record) {
            await interaction.editReply('This appeal could not be recovered from memory, the database, or the review channel.');
            return true;
        }
        if (record.status !== 'Pending') {
            await interaction.editReply(`This appeal has already been ${record.status.toLowerCase()}.`);
            return true;
        }

        const nextStatus: InfractionAppealRecord['status'] = isApproved ? 'Approved' : 'Denied';
        const reviewedAt = new Date();

        if (isDatabaseAvailable()) {
            const updateResult = await InfractionAppeal.updateOne(
                { appealId, status: 'Pending' },
                {
                    $set: {
                        status: nextStatus,
                        reviewedById: interaction.user.id,
                        reviewReason,
                        updatedAt: reviewedAt,
                    },
                },
            ).exec().catch(error => {
                logger.warn(`[InfractionAppeal] Could not persist ${appealId}: ${error instanceof Error ? error.message : 'Unknown'}`);
                return null;
            });

            if (updateResult && updateResult.matchedCount === 0) {
                const latest = await InfractionAppeal.findOne({ appealId }).lean().exec().catch(() => null);
                if (latest && latest.status !== 'Pending') {
                    inMemoryAppeals.set(appealId, latest as unknown as InfractionAppealRecord);
                    await interaction.editReply('This appeal was already reviewed by another staff member.');
                    return true;
                }
            }
        }

        record.status = nextStatus;
        record.reviewedById = interaction.user.id;
        record.reviewReason = reviewReason;
        record.updatedAt = reviewedAt;
        inMemoryAppeals.set(appealId, record);

        let memberNotified = false;
        try {
            const user = await interaction.client.users.fetch(record.userId);
            await user.send({
                components: [buildResultPanel(record, isApproved, interaction.user.id, reviewReason)],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            memberNotified = true;
        } catch (error) {
            logger.warn(`[InfractionAppeal] Could not DM ${record.userId}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        const sourceNotified = isApproved
            ? await postApprovedAppealNotice(interaction.client, record, interaction.user.id, reviewReason)
            : false;

        try {
            const channel = await interaction.client.channels.fetch(record.reviewChannelId).catch(() => null);
            if (channel?.isTextBased() && 'messages' in channel) {
                const reviewMessage = await channel.messages.fetch(record.reviewMessageId).catch(() => null);
                if (reviewMessage) {
                    await reviewMessage.edit({
                        components: [buildReviewPanel(record, {
                            status: nextStatus,
                            reviewedById: interaction.user.id,
                            reason: reviewReason,
                        })],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] },
                    });
                }
            }
        } catch (error) {
            logger.warn(`[InfractionAppeal] Could not update review message: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        await interaction.editReply(
            `Appeal **${appealId}** has been ${isApproved ? 'approved' : 'denied'}.`
            + `${memberNotified ? ' The user was notified by DM.' : ' Warning: the user DM could not be delivered.'}`
            + `${isApproved ? sourceNotified ? ' The infraction channel was updated.' : ' Warning: the infraction channel could not be updated.' : ''}`,
        );
        return true;
    }

    return false;
}
