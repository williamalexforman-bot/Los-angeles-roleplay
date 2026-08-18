import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND, INFRACTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { Infraction, InfractionAppeal, type InfractionAppealRecord } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { getInfractionByThreadIdPublic, recoverInfractionByThreadId, type InfractionRecord } from '../commands/staffManagement';
import { logger } from '../utils/logger';

const INFRACTION_APPEAL_CHANNEL_ID = process.env.INFRACTION_APPEAL_CHANNEL_ID || '1537227443423682612';

let cachedClient: Client | null = null;
const inMemoryAppeals = new Map<string, InfractionAppealRecord>();

export function setInfractionAppealClient(client: Client): void {
    cachedClient = client;
}

function generateAppealId(): string {
    return `IA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
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

async function loadAppeal(appealId: string): Promise<InfractionAppealRecord | null> {
    const memoryRecord = inMemoryAppeals.get(appealId);
    if (memoryRecord) return memoryRecord;
    if (!isDatabaseAvailable()) return null;
    const databaseRecord = await InfractionAppeal.findOne({ appealId }).lean().exec().catch(() => null);
    if (!databaseRecord) return null;
    const normalized = databaseRecord as unknown as InfractionAppealRecord;
    inMemoryAppeals.set(appealId, normalized);
    return normalized;
}

async function loadInfractionForAppeal(
    client: Client,
    threadId: string,
    guildId?: string,
): Promise<InfractionRecord | null> {
    let record = await getInfractionByThreadIdPublic(threadId).catch(() => null);
    if (!record) {
        record = await recoverInfractionByThreadId(client, threadId, guildId).catch(() => null);
    }
    if (record || !isDatabaseAvailable()) return record;

    const databaseRecord = await Infraction.findOne({
        $or: [{ threadId }, { caseNumber: threadId }],
    }).lean().exec().catch(() => null) as unknown as {
        appealable?: boolean;
        action?: string;
        reason?: string;
        caseNumber?: string;
        guildId?: string;
        memberId?: string;
        memberUsername?: string;
        issuedById?: string;
        status?: string;
        parentChannelId?: string;
        headerMessageId?: string;
        detailMessageId?: string;
        createdAt?: Date;
        updatedAt?: Date;
    } | null;
    if (!databaseRecord) return null;

    const createdAt = databaseRecord.createdAt?.toISOString() || new Date().toISOString();
    return {
        caseNumber: databaseRecord.caseNumber || threadId,
        guildId: databaseRecord.guildId || guildId || '',
        memberId: databaseRecord.memberId || '',
        memberUsername: databaseRecord.memberUsername || '',
        issuedById: databaseRecord.issuedById || '',
        action: (databaseRecord.action || 'Warning') as InfractionRecord['action'],
        reason: databaseRecord.reason || 'No reason provided.',
        ruleBroken: databaseRecord.reason || 'No rule supplied.',
        evidence: 'No evidence supplied.',
        internalNotes: 'No internal notes supplied.',
        notifyMember: true,
        appealable: databaseRecord.appealable === undefined ? true : databaseRecord.appealable,
        expiration: 'No expiration set.',
        status: (databaseRecord.status || 'Active') as InfractionRecord['status'],
        parentChannelId: databaseRecord.parentChannelId || '',
        headerMessageId: databaseRecord.headerMessageId || '',
        threadId,
        detailMessageId: databaseRecord.detailMessageId || '',
        createdAt,
        updatedAt: databaseRecord.updatedAt?.toISOString() || createdAt,
        history: [],
    };
}

async function postApprovedAppealNotice(
    client: Client,
    record: InfractionAppealRecord,
    reviewedById: string,
    reviewReason: string,
): Promise<boolean> {
    const noticeEmbed = brandedEmbed('✅ Infraction Appealed', 0x22c55e)
        .setDescription(`Infraction **${record.infractionCaseNumber}** was appealed and the appeal was **approved**.`)
        .addFields(
            { name: 'Member', value: `<@${record.userId}>`, inline: true },
            { name: 'Appeal ID', value: record.appealId, inline: true },
            { name: 'Approved By', value: `<@${reviewedById}>`, inline: true },
            { name: 'Reason', value: reviewReason },
        );
    const notice = legacyEmbedToV2Message(noticeEmbed, { allowedMentions: { parse: [] } });

    const source = await client.channels.fetch(record.infractionThreadId).catch(() => null);
    if (!source) return false;

    if (source.isThread()) {
        // Appeals often arrive after the one-day auto-archive period. Re-open
        // an unlocked source thread so the approval is recorded where the
        // appeal originated.
        if (source.archived && !source.locked) {
            await source.setArchived(false, `${record.appealId} approved`).catch(() => null);
        }
        if (source.isSendable()) {
            const posted = await source.send(notice).then(() => true).catch(() => false);
            if (posted) return true;
        }

        // A locked thread cannot receive messages. Preserve the audit notice
        // in its parent infraction channel instead of silently dropping it.
        const parent = source.parent || (source.parentId
            ? await client.channels.fetch(source.parentId).catch(() => null)
            : null);
        if (parent?.isSendable()) {
            const fallbackNotice = legacyEmbedToV2Message(noticeEmbed, {
                content: `Appeal approved for [${record.infractionCaseNumber}](${record.infractionLink}).`,
                allowedMentions: { parse: [] },
            });
            return parent.send(fallbackNotice).then(() => true).catch(() => false);
        }
        return false;
    }

    if (!source.isSendable()) return false;
    return source.send(notice).then(() => true).catch(() => false);
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

function reviewButtons(appealId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`infraction-appeal:approve:${appealId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`infraction-appeal:deny:${appealId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
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

/**
 * Routes infraction-appeal button interactions. Returns false for unrelated buttons.
 */
export async function handleInfractionAppealButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, threadId] = interaction.customId.split(':');

    if (action === 'start' && threadId) {
        const record = await loadInfractionForAppeal(
            interaction.client,
            threadId,
            interaction.guildId || undefined,
        );

        if (!record) {
            await interaction.reply({ content: 'This infraction record could not be loaded.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!record.appealable) {
            await interaction.reply({ content: 'This infraction is not marked as appealable. Only appealable infractions can be appealed.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (record.memberId && record.memberId !== interaction.user.id) {
            await interaction.reply({ content: 'Only the member who received this infraction can appeal it.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(appealFormModal(threadId));
        return true;
    }

    if ((action === 'approve' || action === 'deny') && threadId) {
        if (!(await canReviewAppeal(interaction))) {
            await interaction.reply({ content: 'You do not have permission to review infraction appeals.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(reviewReasonModal(threadId, action));
        return true;
    }

    return false;
}

/**
 * Routes infraction-appeal modal submissions. Returns false for unrelated modals.
 */
export async function handleInfractionAppealModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, threadId] = interaction.customId.split(':');
    if (!threadId) return false;

    // ── Appeal form submission ──────────────────────────────────────────────
    if (action === 'form') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const discordUsername = interaction.fields.getTextInputValue('discord-username').trim();
        const robloxUsername = interaction.fields.getTextInputValue('roblox-username').trim();
        const appealReason = interaction.fields.getTextInputValue('appeal-reason').trim();
        const willRepeat = interaction.fields.getTextInputValue('will-repeat').trim().toUpperCase();

        // Validate: appeal reason must be 2+ sentences
        const sentenceCount = (appealReason.match(/[.!?]+/g) || []).length;
        if (sentenceCount < 2) {
            await interaction.editReply('Your appeal reason must be **2+ sentences** with details. Please try again.');
            return true;
        }

        // Validate: will-repeat must be YES or NO
        if (willRepeat !== 'YES' && willRepeat !== 'NO') {
            await interaction.editReply('Please answer the "Will you do this again?" question with **YES** or **NO**.');
            return true;
        }

        const client = cachedClient || interaction.client;
        const sourceRecord = await loadInfractionForAppeal(
            client,
            threadId,
            interaction.guildId || undefined,
        );
        if (!sourceRecord) {
            await interaction.editReply('This infraction record could not be loaded. Please open the original infraction and try again.');
            return true;
        }
        if (!sourceRecord.appealable) {
            await interaction.editReply('This infraction is not marked as appealable.');
            return true;
        }
        if (sourceRecord.memberId && sourceRecord.memberId !== interaction.user.id) {
            await interaction.editReply('Only the member who received this infraction can appeal it.');
            return true;
        }

        const infractionSource = await client.channels.fetch(sourceRecord.threadId).catch(() => null);
        const threadUrl = infractionSource?.isThread()
            ? infractionSource.url
            : sourceRecord.parentChannelId && sourceRecord.detailMessageId
                ? `https://discord.com/channels/${sourceRecord.guildId}/${sourceRecord.parentChannelId}/${sourceRecord.detailMessageId}`
                : `https://discord.com/channels/${sourceRecord.guildId || interaction.guildId}/${sourceRecord.threadId}`;
        const noticeChannelId = infractionSource?.isThread()
            ? infractionSource.id
            : sourceRecord.parentChannelId || sourceRecord.threadId;

        const appealId = generateAppealId();
        const embed = brandedEmbed(`⚖️ Infraction Appeal | ${appealId}`)
            .setDescription('A new infraction appeal has been submitted and requires staff review.')
            .addFields(
                { name: 'Appeal ID', value: appealId, inline: true },
                { name: 'Discord User', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Discord Username', value: discordUsername, inline: true },
                { name: 'Roblox Username', value: robloxUsername, inline: true },
                { name: 'Infraction Thread', value: `[Open Thread](${threadUrl})`, inline: true },
                { name: 'Appeal Reason', value: appealReason },
                { name: 'Will Do Again?', value: willRepeat, inline: true },
                { name: 'Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
            );

        const channel = await client.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply('The appeal review channel is unavailable. Please contact staff.');
            return true;
        }

        const reviewMessage = await channel.send(legacyEmbedToV2Message(embed, {
            actionRows: reviewButtons(appealId),
            allowedMentions: { parse: [] },
        }));

        const now = new Date();
        const appealRecord: InfractionAppealRecord = {
            appealId,
            guildId: sourceRecord.guildId || interaction.guildId || '',
            infractionThreadId: noticeChannelId,
            infractionCaseNumber: sourceRecord.caseNumber,
            infractionLink: threadUrl,
            userId: interaction.user.id,
            username: interaction.user.username,
            discordUsername,
            robloxUsername,
            appealReason,
            willRepeat,
            status: 'Pending',
            reviewMessageId: reviewMessage.id,
            reviewChannelId: INFRACTION_APPEAL_CHANNEL_ID,
            createdAt: now,
            updatedAt: now,
        };
        inMemoryAppeals.set(appealId, appealRecord);

        if (isDatabaseAvailable()) {
            await InfractionAppeal.create(appealRecord).catch(error => {
                logger.warn(`[InfractionAppeal] ${appealId} is available in memory, but database persistence failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            });
        }

        await interaction.editReply(`Your infraction appeal **${appealId}** has been submitted. You will receive a DM with the result.`);
        return true;
    }

    // ── Approve / Deny review submission ────────────────────────────────────
    if ((action === 'approve-modal' || action === 'deny-modal') && threadId) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const reviewReason = interaction.fields.getTextInputValue('review-reason').trim();
        const isApproved = action === 'approve-modal';
        const appealId = threadId;

        if (!(await canReviewAppeal(interaction))) {
            await interaction.editReply('You do not have permission to review infraction appeals.');
            return true;
        }

        const record = await loadAppeal(appealId);
        if (!record) {
            await interaction.editReply('This appeal could not be found.');
            return true;
        }
        if (record.status !== 'Pending') {
            await interaction.editReply(`This appeal has already been ${record.status.toLowerCase()}.`);
            return true;
        }

        const nextStatus = isApproved ? 'Approved' : 'Denied';
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
                logger.warn(`[InfractionAppeal] Could not persist the ${appealId} review result: ${error instanceof Error ? error.message : 'Unknown'}`);
                return null;
            });
            if (updateResult && updateResult.matchedCount === 0) {
                const latest = await InfractionAppeal.findOne({ appealId }).lean().exec().catch(() => null);
                if (latest && latest.status !== 'Pending') {
                    inMemoryAppeals.set(appealId, latest as unknown as InfractionAppealRecord);
                    await interaction.editReply('This appeal was already reviewed by another staff member.');
                    return true;
                }
                logger.warn(`[InfractionAppeal] ${appealId} was not found in the database; completing the review with the in-memory record.`);
            }
        }
        record.status = nextStatus;
        record.reviewedById = interaction.user.id;
        record.reviewReason = reviewReason;
        record.updatedAt = reviewedAt;
        inMemoryAppeals.set(appealId, record);

        // ── DM the user with the result + reason ────────────────────────────
        const resultEmbed = brandedEmbed(
            isApproved ? '✅ Infraction Appeal Approved' : '❌ Infraction Appeal Denied',
            isApproved ? 0x22c55e : 0xef4444,
        )
            .setDescription(
                isApproved
                    ? 'Your infraction appeal has been **approved**!'
                    : 'Unfortunately, your infraction appeal has been **denied**.',
            )
            .addFields(
                { name: 'Appeal ID', value: appealId, inline: true },
                { name: 'Reason', value: reviewReason },
                { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
            );

        let memberNotified = false;
        try {
            const user = await interaction.client.users.fetch(record.userId);
            await user.send(legacyEmbedToV2Message(resultEmbed));
            memberNotified = true;
        } catch (error) {
            logger.warn(`[InfractionAppeal] Could not DM ${record.userId}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        // Record approved appeals in the originating infraction thread. If it
        // is locked, post the audit notice in its parent infraction channel.
        const sourceNotified = isApproved
            ? await postApprovedAppealNotice(interaction.client, record, interaction.user.id, reviewReason)
            : false;
        if (isApproved && !sourceNotified) {
            logger.warn(`[InfractionAppeal] Could not post the ${appealId} approval in its source infraction channel.`);
        }

        // ── Update the review message ───────────────────────────────────────
        try {
            const channel = await interaction.client.channels.fetch(record.reviewChannelId).catch(() => null);
            if (channel?.isSendable()) {
                const reviewMessage = await channel.messages.fetch(record.reviewMessageId).catch(() => null);
                if (reviewMessage) {
                    const updatedEmbed = brandedEmbed(
                        `⚖️ Infraction Appeal | ${appealId}`,
                        isApproved ? 0x22c55e : 0xef4444,
                    )
                        .setDescription(`This infraction appeal has been **${isApproved ? 'approved' : 'denied'}**.`)
                        .addFields(
                            { name: 'Appeal ID', value: appealId, inline: true },
                            { name: 'Discord User', value: `<@${record.userId}>`, inline: true },
                            { name: 'Status', value: isApproved ? '✅ Approved' : '❌ Denied', inline: true },
                            { name: 'Infraction Thread', value: `[Open Thread](${record.infractionLink})`, inline: true },
                            { name: 'Review Reason', value: reviewReason },
                            { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                        );
                    await reviewMessage.edit({
                        ...legacyEmbedToV2Message(updatedEmbed),
                        content: null,
                        embeds: [],
                        attachments: [],
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
