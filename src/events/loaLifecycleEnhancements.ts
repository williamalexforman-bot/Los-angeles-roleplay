import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Events,
    MessageFlags,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    TextChannel,
    type ChatInputCommandInteraction,
    type GuildMember,
    type Message,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import {
    AuditEvent,
    LoaRequest as LoaRequestModel,
    type LoaRequestRecord,
} from '../database/models';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const LOA_REVIEW_CHANNEL_ID = process.env.LOA_REQUEST_CHANNEL_ID || '1528206019237515344';
const LOA_ACTIVE_CHANNEL_ID = '1541223750832357456';
// The historical LOA channel is retained as the default logs destination. If
// the host already has a dedicated LOA_LOG_CHANNEL_ID/LOA_LOGS_CHANNEL_ID, it
// wins automatically without another code change.
const LOA_LOG_CHANNEL_ID = process.env.LOA_LOG_CHANNEL_ID
    || process.env.LOA_LOGS_CHANNEL_ID
    || LOA_REVIEW_CHANNEL_ID;
const LOA_ROLE_ID = process.env.LOA_ROLE_ID || '1521593407795888329';
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MAX_TIMEOUT_MS = 2_147_000_000;

const LOA_MANAGEMENT_ROLE_IDS = Array.from(new Set([
    process.env.BOT_PERMISSIONS_ROLE_ID,
    process.env.ADMIN_ROLE_ID,
    process.env.INFRACTION_AUTHORIZED_ROLE_ID,
    ...(process.env.LOA_MANAGEMENT_ROLE_IDS || '').split(','),
].map(value => value?.trim()).filter((value): value is string => Boolean(value))));

type LoaModule = {
    handleLoaButton: (interaction: ButtonInteraction) => Promise<boolean>;
    handleLoaModal: (interaction: ModalSubmitInteraction) => Promise<boolean>;
    loaCommand?: {
        execute?: (interaction: ChatInputCommandInteraction) => Promise<void>;
    };
};

type ComponentNode = {
    content?: unknown;
    custom_id?: string;
    disabled?: boolean;
    components?: readonly ComponentNode[];
};

interface ActiveLoaInfo {
    pendingId: string;
    guildId: string;
    userId: string;
    name: string;
    reason: string;
    startAt: string;
    endAt: string;
    approvedById?: string;
    activeMessageId?: string;
}

type EndMode = 'expired' | 'early';

const endTimers = new Map<string, ReturnType<typeof setTimeout>>();
const roleGuardTimers = new Map<string, ReturnType<typeof setTimeout>>();
const completedInProcess = new Set<string>();
let installed = false;

function parseDateOnly(value: string, endOfDay: boolean): Date | null {
    const match = value.trim().match(DATE_ONLY_RE);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = endOfDay
        ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
        : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    if (date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day) return null;
    return date;
}

function normalizeStartDate(value: string): Date | null {
    const strict = parseDateOnly(value, false);
    if (strict) return strict;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeEndDate(value: string): Date | null {
    const strict = parseDateOnly(value, true);
    if (strict) return strict;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? value
        : `<t:${Math.floor(parsed.getTime() / 1_000)}:F>`;
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

function walkComponents(message: Message): ComponentNode[] {
    return message.components.map(component => component.toJSON() as unknown as ComponentNode);
}

function allComponentText(message: Message): string[] {
    const values: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.content === 'string') values.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const node of walkComponents(message)) visit(node);
    return values;
}

function componentField(message: Message, name: string): string {
    const prefix = `**${name}**\n`;
    const value = allComponentText(message)
        .find(candidate => candidate.toLowerCase().startsWith(prefix.toLowerCase()));
    return value?.slice(prefix.length).trim() || '';
}

function customIds(message: Message): string[] {
    const values: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.custom_id === 'string') values.push(node.custom_id);
        for (const child of node.components || []) visit(child);
    };
    for (const node of walkComponents(message)) visit(node);
    return values;
}

function parseDiscordTimestamp(value: string): Date | null {
    const unix = value.match(/<t:(\d+)(?::[A-Za-z])?>/u)?.[1];
    if (unix) return new Date(Number(unix) * 1_000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function activeInfoFromMessage(message: Message): ActiveLoaInfo | null {
    const endEarlyId = customIds(message).find(id => id.startsWith('loa:active:end-early:'));
    if (!endEarlyId) return null;
    const pendingId = endEarlyId.slice('loa:active:end-early:'.length);
    const memberField = componentField(message, 'Member');
    const userId = memberField.match(/<@!?(\d{17,20})>/u)?.[1]
        || pendingId.match(/^(\d{17,20})-/u)?.[1];
    const start = parseDiscordTimestamp(componentField(message, 'Start Date'));
    const end = parseDiscordTimestamp(componentField(message, 'End Date'));
    if (!pendingId || !userId || !start || !end) return null;
    return {
        pendingId,
        guildId: message.guildId || '',
        userId,
        name: componentField(message, 'Name') || userId,
        reason: componentField(message, 'Reason') || 'No reason supplied.',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        approvedById: componentField(message, 'Approved By').match(/<@!?(\d{17,20})>/u)?.[1],
        activeMessageId: message.id,
    };
}

function recordToActiveInfo(record: LoaRequestRecord, pendingId: string): ActiveLoaInfo | null {
    const start = normalizeStartDate(record.startDate);
    const end = normalizeEndDate(record.endDate);
    if (!start || !end) return null;
    return {
        pendingId,
        guildId: record.guildId,
        userId: record.userId,
        name: record.name || record.memberUsername || record.userId,
        reason: record.reason || 'No reason supplied.',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        approvedById: record.reviewerId,
    };
}

function activeButtons(pendingId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`loa:active:end-early:${pendingId}`)
                .setLabel('End Early')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
}

function activeEmbed(info: ActiveLoaInfo): EmbedBuilder {
    return brandedEmbed('🟢 Active Leave of Absence', 0x22c55e)
        .setDescription('This Leave of Absence is currently active. Management or the member may use **End Early** if the LOA is no longer needed.')
        .addFields(
            { name: 'Member', value: `<@${info.userId}>`, inline: true },
            { name: 'Name', value: info.name, inline: true },
            { name: 'Start Date', value: dateTimestamp(info.startAt), inline: true },
            { name: 'End Date', value: dateTimestamp(info.endAt), inline: true },
            { name: 'Reason', value: info.reason },
            { name: 'Approved By', value: info.approvedById ? `<@${info.approvedById}>` : 'Management', inline: true },
            { name: 'LOA Role', value: `<@&${LOA_ROLE_ID}>`, inline: true },
            { name: 'Status', value: '🟢 Active', inline: true },
        );
}

function endedEmbed(
    info: ActiveLoaInfo,
    mode: EndMode,
    endedById: string | undefined,
    roleRemoved: boolean,
): EmbedBuilder {
    const title = mode === 'early' ? '⏹️ LOA Ended Early' : '✅ LOA Completed';
    const color = mode === 'early' ? 0xf59e0b : 0x22c55e;
    const embed = brandedEmbed(title, color)
        .setDescription(
            mode === 'early'
                ? 'This Leave of Absence was ended before its scheduled completion date.'
                : 'This Leave of Absence reached its scheduled end date and has been completed automatically.',
        )
        .addFields(
            { name: 'Member', value: `<@${info.userId}>`, inline: true },
            { name: 'Name', value: info.name, inline: true },
            { name: 'Start Date', value: dateTimestamp(info.startAt), inline: true },
            { name: 'Scheduled End', value: dateTimestamp(info.endAt), inline: true },
            { name: 'Ended At', value: `<t:${Math.floor(Date.now() / 1_000)}:F>`, inline: true },
            { name: 'LOA Role Removed', value: roleRemoved ? '✅ Yes' : '⚠️ Could not confirm', inline: true },
            { name: 'Reason', value: info.reason },
        );
    if (endedById) embed.addFields({ name: 'Ended By', value: `<@${endedById}>`, inline: true });
    return embed;
}

async function fetchMember(client: Client, guildId: string, userId: string): Promise<GuildMember | null> {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    return guild.members.fetch(userId).catch(() => null);
}

async function ensureLoaRole(member: GuildMember): Promise<boolean> {
    try {
        if (member.roles.cache.has(LOA_ROLE_ID)) return true;
        await member.roles.add(LOA_ROLE_ID, 'LOA remains active through the selected end date');
        return true;
    } catch (error) {
        logger.warn(`[LOA] Could not preserve LOA role for ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function removeLoaRole(member: GuildMember): Promise<boolean> {
    try {
        if (!member.roles.cache.has(LOA_ROLE_ID)) return true;
        await member.roles.remove(LOA_ROLE_ID, 'Leave of Absence ended');
        return true;
    } catch (error) {
        logger.warn(`[LOA] Could not remove LOA role from ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function alreadyCompleted(pendingId: string): Promise<boolean> {
    if (completedInProcess.has(pendingId)) return true;
    if (!isDatabaseAvailable()) return false;
    const existing = await AuditEvent.findOne({ kind: 'loa-ended', targetId: pendingId })
        .lean()
        .exec()
        .catch(() => null);
    if (existing) completedInProcess.add(pendingId);
    return Boolean(existing);
}

async function markCompleted(info: ActiveLoaInfo, mode: EndMode, endedById?: string): Promise<void> {
    completedInProcess.add(info.pendingId);
    if (!isDatabaseAvailable()) return;
    await AuditEvent.create({
        guildId: info.guildId,
        kind: 'loa-ended',
        actorId: endedById || 'automatic',
        targetId: info.pendingId,
        metadata: {
            userId: info.userId,
            mode,
            startAt: info.startAt,
            endAt: info.endAt,
            endedAt: new Date().toISOString(),
        },
    }).catch(error => {
        logger.warn(`[LOA] Could not persist completion audit for ${info.pendingId}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function findActiveMessage(client: Client, pendingId: string): Promise<Message | null> {
    const channel = await client.channels.fetch(LOA_ACTIVE_CHANNEL_ID).catch(() => null);
    if (!(channel instanceof TextChannel)) return null;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return null;
    return messages.find(message => customIds(message).includes(`loa:active:end-early:${pendingId}`)) || null;
}

async function postCompletionLog(
    client: Client,
    info: ActiveLoaInfo,
    mode: EndMode,
    endedById: string | undefined,
    roleRemoved: boolean,
): Promise<boolean> {
    const channel = await client.channels.fetch(LOA_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[LOA] Completion log channel ${LOA_LOG_CHANNEL_ID} is unavailable.`);
        return false;
    }
    return channel.send(legacyEmbedToV2Message(
        endedEmbed(info, mode, endedById, roleRemoved),
        {
            content: `<@${info.userId}>`,
            allowedMentions: { parse: [], users: [info.userId] },
        },
    )).then(() => true).catch(error => {
        logger.warn(`[LOA] Could not post completion log for ${info.pendingId}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    });
}

async function notifyMemberEnded(
    member: GuildMember,
    info: ActiveLoaInfo,
    mode: EndMode,
): Promise<void> {
    const embed = brandedEmbed(
        mode === 'early' ? '⏹️ Your LOA Ended Early' : '✅ Your LOA Has Ended',
        mode === 'early' ? 0xf59e0b : 0x22c55e,
    )
        .setDescription(
            mode === 'early'
                ? 'Your Leave of Absence has been ended early and the LOA role has been removed.'
                : 'Your Leave of Absence has reached its end date and the LOA role has been removed automatically.',
        )
        .addFields(
            { name: 'Start Date', value: dateTimestamp(info.startAt), inline: true },
            { name: 'End Date', value: dateTimestamp(info.endAt), inline: true },
        );
    await member.send(legacyEmbedToV2Message(embed)).catch(() => undefined);
}

function clearLifecycleTimers(pendingId: string): void {
    const endTimer = endTimers.get(pendingId);
    if (endTimer) clearTimeout(endTimer);
    endTimers.delete(pendingId);
    const guardTimer = roleGuardTimers.get(pendingId);
    if (guardTimer) clearTimeout(guardTimer);
    roleGuardTimers.delete(pendingId);
}

async function completeLoa(
    client: Client,
    info: ActiveLoaInfo,
    mode: EndMode,
    endedById?: string,
    knownMessage?: Message,
): Promise<boolean> {
    if (await alreadyCompleted(info.pendingId)) {
        const stale = knownMessage || await findActiveMessage(client, info.pendingId);
        if (stale) await stale.delete().catch(() => undefined);
        clearLifecycleTimers(info.pendingId);
        return false;
    }

    const member = await fetchMember(client, info.guildId, info.userId);
    const roleRemoved = member ? await removeLoaRole(member) : false;
    const logged = await postCompletionLog(client, info, mode, endedById, roleRemoved);

    // Do not mark the lifecycle finished until the log was actually written.
    // That makes a temporary missing-permission/channel problem retryable.
    if (!logged) return false;

    await markCompleted(info, mode, endedById);
    if (member) await notifyMemberEnded(member, info, mode);

    const activeMessage = knownMessage || await findActiveMessage(client, info.pendingId);
    if (activeMessage) await activeMessage.delete().catch(error => {
        logger.warn(`[LOA] Could not remove completed active LOA message ${activeMessage.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
    clearLifecycleTimers(info.pendingId);
    logger.info(`[LOA] ${info.pendingId} completed (${mode}); role cleanup=${roleRemoved}.`);
    return true;
}

function scheduleRoleGuard(client: Client, info: ActiveLoaInfo): void {
    // Old LOA code treated a date-only end value as the beginning of that date.
    // If an in-memory legacy timer still exists, this guard restores the role
    // a few seconds later and keeps it until 23:59:59 of the selected end date.
    const selectedDate = info.endAt.slice(0, 10);
    const beginning = parseDateOnly(selectedDate, false);
    const finalEnd = new Date(info.endAt);
    if (!beginning || Number.isNaN(finalEnd.getTime())) return;
    const guardAt = beginning.getTime() + 7_500;
    if (guardAt <= Date.now() || guardAt >= finalEnd.getTime()) return;

    const delay = guardAt - Date.now();
    if (delay > MAX_TIMEOUT_MS) return;
    const timer = setTimeout(async () => {
        roleGuardTimers.delete(info.pendingId);
        if (await alreadyCompleted(info.pendingId) || Date.now() >= finalEnd.getTime()) return;
        const member = await fetchMember(client, info.guildId, info.userId);
        if (member) await ensureLoaRole(member);
    }, delay);
    timer.unref?.();
    roleGuardTimers.set(info.pendingId, timer);
}

function scheduleEnd(client: Client, info: ActiveLoaInfo, message?: Message): void {
    clearLifecycleTimers(info.pendingId);
    const end = new Date(info.endAt).getTime();
    if (!Number.isFinite(end)) return;

    const schedule = (): void => {
        const remaining = end - Date.now();
        if (remaining <= 0) {
            void completeLoa(client, info, 'expired', undefined, message);
            return;
        }
        const wait = Math.min(remaining, MAX_TIMEOUT_MS);
        const timer = setTimeout(() => {
            endTimers.delete(info.pendingId);
            schedule();
        }, wait);
        timer.unref?.();
        endTimers.set(info.pendingId, timer);
    };
    schedule();
    scheduleRoleGuard(client, info);
}

async function canEndEarly(interaction: ButtonInteraction, userId: string): Promise<boolean> {
    if (interaction.user.id === userId) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const member = interaction.member;
    const hasRole = (roleId: string): boolean => {
        if (!member || !roleId) return false;
        const roles = (member as { roles?: { cache?: { has(id: string): boolean } } | string[] }).roles;
        if (!roles) return false;
        if (Array.isArray(roles)) return roles.includes(roleId);
        return roles.cache?.has(roleId) ?? false;
    };
    if (LOA_MANAGEMENT_ROLE_IDS.some(hasRole)) return true;

    try {
        const fetched = await interaction.guild?.members.fetch(interaction.user.id);
        return Boolean(fetched && LOA_MANAGEMENT_ROLE_IDS.some(roleId => fetched.roles.cache.has(roleId)));
    } catch {
        return false;
    }
}

async function loadStoredRecord(pendingId: string): Promise<LoaRequestRecord | null> {
    if (!isDatabaseAvailable()) return null;
    return LoaRequestModel.findOne({ pendingId }).lean().exec()
        .then(record => record as unknown as LoaRequestRecord | null)
        .catch(() => null);
}

async function normalizeStoredDatesBeforeApproval(pendingId: string): Promise<void> {
    if (!isDatabaseAvailable()) return;
    const record = await loadStoredRecord(pendingId);
    if (!record) return;
    const start = normalizeStartDate(record.startDate);
    const end = normalizeEndDate(record.endDate);
    if (!start || !end) return;
    await LoaRequestModel.updateOne(
        { pendingId },
        {
            $set: {
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                updatedAt: new Date(),
            },
        },
    ).exec().catch(error => {
        logger.warn(`[LOA] Could not normalize stored dates for ${pendingId}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function infoFromReviewMessage(interaction: ButtonInteraction, pendingId: string): ActiveLoaInfo | null {
    const requestedBy = componentField(interaction.message, 'Requested By');
    const userId = requestedBy.match(/<@!?(\d{17,20})>/u)?.[1]
        || pendingId.match(/^(\d{17,20})-/u)?.[1];
    const start = parseDiscordTimestamp(componentField(interaction.message, 'Start Date'));
    const endRaw = parseDiscordTimestamp(componentField(interaction.message, 'End Date'));
    if (!userId || !start || !endRaw || !interaction.guildId) return null;

    const endDateText = endRaw.toISOString().slice(0, 10);
    const end = parseDateOnly(endDateText, true) || endRaw;
    return {
        pendingId,
        guildId: interaction.guildId,
        userId,
        name: componentField(interaction.message, 'Name') || userId,
        reason: componentField(interaction.message, 'Reason') || 'No reason supplied.',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        approvedById: interaction.user.id,
    };
}

async function deleteLegacyApprovedCopy(client: Client, info: ActiveLoaInfo): Promise<void> {
    const channel = await client.channels.fetch(LOA_REVIEW_CHANNEL_ID).catch(() => null);
    if (!(channel instanceof TextChannel)) return;
    const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    if (!messages) return;

    const candidate = messages.find(message => {
        if (message.author.id !== client.user?.id) return false;
        if (Date.now() - message.createdTimestamp > 60_000) return false;
        const serialized = JSON.stringify(walkComponents(message));
        return /LOA Approved/iu.test(serialized) && serialized.includes(`<@${info.userId}>`);
    });
    if (candidate) await candidate.delete().catch(() => undefined);
}

async function postActiveLoa(client: Client, info: ActiveLoaInfo): Promise<Message | null> {
    const channel = await client.channels.fetch(LOA_ACTIVE_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[LOA] Active LOA channel ${LOA_ACTIVE_CHANNEL_ID} is unavailable.`);
        return null;
    }

    // Prevent a duplicate active card if Discord retried the review interaction.
    const existing = await findActiveMessage(client, info.pendingId);
    if (existing) {
        scheduleEnd(client, { ...info, activeMessageId: existing.id }, existing);
        return existing;
    }

    const message = await channel.send(legacyEmbedToV2Message(activeEmbed(info), {
        content: `<@${info.userId}>`,
        actionRows: activeButtons(info.pendingId),
        allowedMentions: { parse: [], users: [info.userId] },
    })).catch(error => {
        logger.warn(`[LOA] Could not post active LOA ${info.pendingId}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    });
    if (!message) return null;
    info.activeMessageId = message.id;
    scheduleEnd(client, info, message);
    return message;
}

async function afterApproval(
    interaction: ButtonInteraction,
    pendingId: string,
): Promise<void> {
    let info: ActiveLoaInfo | null = null;
    const stored = await loadStoredRecord(pendingId);
    if (stored && stored.status === 'Approved') info = recordToActiveInfo(stored, pendingId);
    if (!info) info = infoFromReviewMessage(interaction, pendingId);
    if (!info) {
        logger.warn(`[LOA] Approved ${pendingId}, but the active LOA card could not be reconstructed.`);
        return;
    }
    info.approvedById = interaction.user.id;

    await deleteLegacyApprovedCopy(interaction.client, info);
    const activeMessage = await postActiveLoa(interaction.client, info);
    if (activeMessage && (interaction.deferred || interaction.replied)) {
        await interaction.editReply(
            `✅ LOA for **${info.name}** approved. The active LOA is now tracked in <#${LOA_ACTIVE_CHANNEL_ID}> with an **End Early** button.`,
        ).catch(() => undefined);
    }
}

function validateDateInputs(startText: string, endText: string): string | null {
    const start = parseDateOnly(startText, false);
    const end = parseDateOnly(endText, true);
    if (!start || !end) {
        return 'Start Date and End Date must use the exact **YYYY-MM-DD** format. Example: `2026-08-24`. Dates such as `8/24/26`, `tomorrow`, or `August 24` are not accepted.';
    }
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    if (start.getTime() < todayUtc.getTime()) {
        return 'The LOA start date cannot be in the past. Use today or a future date in **YYYY-MM-DD** format.';
    }
    if (end.getTime() < start.getTime()) {
        return 'The LOA end date cannot be before the start date. Please check both dates and submit again.';
    }
    return null;
}

async function recoverExistingActiveLoas(client: Client): Promise<void> {
    const channel = await client.channels.fetch(LOA_ACTIVE_CHANNEL_ID).catch(() => null);
    if (!(channel instanceof TextChannel)) {
        logger.warn(`[LOA] Active LOA recovery skipped because <#${LOA_ACTIVE_CHANNEL_ID}> is unavailable.`);
        return;
    }
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;
    let recovered = 0;
    for (const message of messages.values()) {
        const info = activeInfoFromMessage(message);
        if (!info) continue;
        recovered += 1;
        scheduleEnd(client, info, message);
    }
    logger.info(`[LOA] Recovered ${recovered} active LOA lifecycle timer(s) from Discord.`);
}

function installModuleWrappers(client: Client): void {
    const loaModule = require('../commands/loa.ts') as LoaModule;
    const originalButton = loaModule.handleLoaButton.bind(loaModule);
    const originalModal = loaModule.handleLoaModal.bind(loaModule);

    loaModule.handleLoaModal = async (interaction: ModalSubmitInteraction): Promise<boolean> => {
        if (interaction.customId === 'loa:request:modal') {
            const startText = interaction.fields.getTextInputValue('start_date').trim();
            const endText = interaction.fields.getTextInputValue('end_date').trim();
            const validationError = validateDateInputs(startText, endText);
            if (validationError) {
                await interaction.reply({
                    content: `📅 ${validationError}`,
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
        }
        return originalModal(interaction);
    };

    loaModule.handleLoaButton = async (interaction: ButtonInteraction): Promise<boolean> => {
        const endEarlyMatch = interaction.customId.match(/^loa:active:end-early:(.+)$/u);
        if (endEarlyMatch) {
            const info = activeInfoFromMessage(interaction.message);
            if (!info) {
                await interaction.reply({
                    content: 'This active LOA record could not be read. Please contact management.',
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
            if (!(await canEndEarly(interaction, info.userId))) {
                await interaction.reply({
                    content: 'Only the member on this LOA or management can end it early.',
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const completed = await completeLoa(
                interaction.client,
                info,
                'early',
                interaction.user.id,
                interaction.message,
            );
            await interaction.editReply(
                completed
                    ? `✅ The LOA for **${info.name}** was ended early, the LOA role was removed, and the completion was sent to <#${LOA_LOG_CHANNEL_ID}>.`
                    : 'This LOA was already ended, or the completion log could not be sent. If it is still visible, check the LOA logs channel permissions.',
            );
            return true;
        }

        const reviewMatch = interaction.customId.match(/^loa:review:(approve|deny):(.+)$/u);
        if (reviewMatch?.[1] === 'approve') {
            await normalizeStoredDatesBeforeApproval(reviewMatch[2]);
        }

        const handled = await originalButton(interaction);
        if (handled && reviewMatch?.[1] === 'approve') {
            await afterApproval(interaction, reviewMatch[2]);
        }
        return handled;
    };

    logger.info('[LOA] Lifecycle wrappers installed: strict dates, active channel, End Early, and completion logs.');
}

export function registerLoaLifecycleEnhancements(client: Client): void {
    if (installed) return;
    installed = true;

    installModuleWrappers(client);

    // Schedule cards posted by this process even if they come from a future
    // code path, without polling Discord every minute.
    client.on(Events.MessageCreate, message => {
        if (message.channelId !== LOA_ACTIVE_CHANNEL_ID) return;
        const info = activeInfoFromMessage(message);
        if (info) scheduleEnd(client, info, message);
    });

    void recoverExistingActiveLoas(client).catch(error => {
        logger.warn(`[LOA] Active lifecycle recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    logger.info(`[LOA] Active LOAs -> ${LOA_ACTIVE_CHANNEL_ID}; completed LOAs -> ${LOA_LOG_CHANNEL_ID}.`);
}
