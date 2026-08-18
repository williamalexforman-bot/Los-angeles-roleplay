import {
    AttachmentBuilder,
    AuditLogEvent,
    Client,
    EmbedBuilder,
    GuildBan,
    GuildMember,
    Message,
    PermissionFlagsBits,
    type PartialGuildMember,
} from 'discord.js';
import sharp from 'sharp';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const RAID_CHANNEL_ID = CHANNEL_IDS.raidThreatLog;
const TIMEOUT_MS = 5 * 60 * 1000;
const SPAM_WINDOW_MS = 8_000;
const SPAM_MESSAGE_THRESHOLD = 7;
const REPEAT_WINDOW_MS = 12_000;
const REPEAT_MESSAGE_THRESHOLD = 4;
const MASS_ACTION_WINDOW_MS = 12_000;
const SAME_EXECUTOR_ACTION_THRESHOLD = 3;
const GLOBAL_ACTION_THRESHOLD = 5;
const ALERT_COOLDOWN_MS = 30_000;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 3;

interface ModerationAction {
    kind: 'Kick' | 'Ban';
    targetId: string;
    executorId: string | null;
    at: number;
}

interface UserMessageState {
    timestamps: number[];
    messages: Array<{ normalized: string; at: number }>;
    lastAlertAt: number;
}

type UnknownRecord = Record<string, unknown>;

const actionHistory = new Map<string, ModerationAction[]>();
const messageHistory = new Map<string, UserMessageState>();
const massActionAlertAt = new Map<string, number>();
const imageModerationInFlight = new Set<string>();
let imageModerationMissingKeyLogged = false;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emergencyRoleId(): string | null {
    const value = process.env.EMERGENCY_STAFF_ROLE_ID?.trim() || '';
    return /^\d{17,20}$/.test(value) ? value : null;
}

async function sendRaidAlert(client: Client, embed: EmbedBuilder, files: AttachmentBuilder[] = []): Promise<void> {
    const channel = await client.channels.fetch(RAID_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) return;
    const roleId = emergencyRoleId();
    await channel.send(legacyEmbedToV2Message(embed, {
        content: roleId ? `<@&${roleId}>` : undefined,
        files,
        allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
    })).catch(error => {
        logger.warn(`[Raid Protection] Could not send raid alert: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

function actionKey(guildId: string, executorId: string | null): string {
    return `${guildId}:${executorId || 'unknown'}`;
}

function pruneActions(guildId: string, now: number): ModerationAction[] {
    const current = (actionHistory.get(guildId) || []).filter(action => now - action.at <= MASS_ACTION_WINDOW_MS);
    actionHistory.set(guildId, current);
    return current;
}

async function recordModerationAction(
    client: Client,
    guildId: string,
    action: ModerationAction,
): Promise<void> {
    const now = Date.now();
    const recent = pruneActions(guildId, now);
    recent.push(action);
    actionHistory.set(guildId, recent);

    const byExecutor = action.executorId
        ? recent.filter(item => item.executorId === action.executorId)
        : [];
    const sameExecutorTriggered = byExecutor.length >= SAME_EXECUTOR_ACTION_THRESHOLD;
    const globalTriggered = recent.length >= GLOBAL_ACTION_THRESHOLD;
    if (!sameExecutorTriggered && !globalTriggered) return;

    const key = actionKey(guildId, sameExecutorTriggered ? action.executorId : null);
    const previousAlert = massActionAlertAt.get(key) || 0;
    if (now - previousAlert < ALERT_COOLDOWN_MS) return;
    massActionAlertAt.set(key, now);

    const recentTargets = recent.slice(-8).map(item => `<@${item.targetId}> (${item.kind})`).join('\n');
    const executorLine = action.executorId ? `<@${action.executorId}>` : 'Unknown / unresolved audit-log actor';
    const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setAuthor({ name: 'LARP Raid Protection' })
        .setTitle('🚨 Mass Kick/Ban Activity Detected')
        .setDescription('A burst of moderation removals was detected within a short time window. Staff should immediately verify whether the activity is authorized.')
        .addFields(
            { name: 'Recent Actions', value: String(recent.length), inline: true },
            { name: 'Same Executor Actions', value: String(byExecutor.length), inline: true },
            { name: 'Executor', value: executorLine, inline: true },
            { name: 'Recent Targets', value: recentTargets || 'Unavailable', inline: false },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    await sendRaidAlert(client, embed);
}

async function fetchMatchingAuditEntry(
    guild: GuildMember['guild'],
    type: AuditLogEvent.MemberKick | AuditLogEvent.MemberBanAdd,
    targetId: string,
): Promise<{ executorId: string | null } | null> {
    // Audit-log delivery can trail the gateway event slightly.
    await new Promise(resolve => setTimeout(resolve, 700));
    const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
    if (!logs) return null;
    const now = Date.now();
    const entry = logs.entries.find(candidate =>
        candidate.targetId === targetId
        && now - candidate.createdTimestamp <= 12_000,
    );
    if (!entry) return null;
    return { executorId: entry.executor?.id || null };
}

async function handleMemberRemoved(member: GuildMember | PartialGuildMember): Promise<void> {
    const audit = await fetchMatchingAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!audit) return;
    await recordModerationAction(member.client, member.guild.id, {
        kind: 'Kick',
        targetId: member.id,
        executorId: audit.executorId,
        at: Date.now(),
    });
}

async function handleMemberBanned(ban: GuildBan): Promise<void> {
    const audit = await fetchMatchingAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await recordModerationAction(ban.client, ban.guild.id, {
        kind: 'Ban',
        targetId: ban.user.id,
        executorId: audit?.executorId || null,
        at: Date.now(),
    });
}

function normalizedMessage(content: string): string {
    return content
        .toLocaleLowerCase()
        .replace(/https?:\/\/\S+/gu, '<url>')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

async function timeoutMember(message: Message, reason: string): Promise<boolean> {
    const member = message.member || await message.guild?.members.fetch(message.author.id).catch(() => null);
    if (!member || !member.moderatable) return false;
    try {
        await member.timeout(TIMEOUT_MS, reason);
        return true;
    } catch {
        return false;
    }
}

function spamDetection(message: Message): { triggered: boolean; reason: string; count: number } {
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const state = messageHistory.get(key) || { timestamps: [], messages: [], lastAlertAt: 0 };
    state.timestamps = state.timestamps.filter(timestamp => now - timestamp <= SPAM_WINDOW_MS);
    state.messages = state.messages.filter(item => now - item.at <= REPEAT_WINDOW_MS);
    state.timestamps.push(now);

    const normalized = normalizedMessage(message.content);
    if (normalized) state.messages.push({ normalized, at: now });

    const exactRepeatCount = normalized
        ? state.messages.filter(item => item.normalized === normalized).length
        : 0;
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    const massMentionSpam = (message.mentions.everyone || mentionCount >= 6) && state.timestamps.length >= 3;
    const burstSpam = state.timestamps.length >= SPAM_MESSAGE_THRESHOLD;
    const repeatSpam = exactRepeatCount >= REPEAT_MESSAGE_THRESHOLD;
    const triggered = burstSpam || repeatSpam || massMentionSpam;

    let reason = 'Rapid message spam';
    if (repeatSpam) reason = 'Repeated-message spam';
    if (massMentionSpam) reason = 'Mass-mention spam';

    messageHistory.set(key, state);
    return {
        triggered: triggered && now - state.lastAlertAt >= ALERT_COOLDOWN_MS,
        reason,
        count: state.timestamps.length,
    };
}

async function handleSpam(message: Message): Promise<void> {
    const detection = spamDetection(message);
    if (!detection.triggered) return;

    const key = `${message.guildId}:${message.author.id}`;
    const state = messageHistory.get(key);
    if (state) state.lastAlertAt = Date.now();

    const timedOut = await timeoutMember(message, `Raid protection: ${detection.reason}`);
    await message.delete().catch(() => undefined);

    const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setAuthor({ name: 'LARP Raid Protection', iconURL: message.author.displayAvatarURL() })
        .setTitle('🚨 Spam Raid Activity Detected')
        .setDescription('A member crossed the high-confidence spam threshold. The current spam message was removed.')
        .addFields(
            { name: 'Member', value: `<@${message.author.id}>`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Detection', value: detection.reason, inline: true },
            { name: 'Messages in Window', value: String(detection.count), inline: true },
            { name: 'Automatic Action', value: timedOut ? '5-minute timeout applied' : 'Timeout could not be applied; check role hierarchy/permissions', inline: false },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    await sendRaidAlert(message.client, embed);
}

function isImageAttachment(attachment: { contentType?: string | null; name?: string | null; url: string }): boolean {
    if (attachment.contentType?.toLowerCase().startsWith('image/')) return true;
    const filename = attachment.name?.toLowerCase() || '';
    return /\.(?:png|jpe?g|webp|gif)$/u.test(filename);
}

async function imageIsSexual(imageUrl: string): Promise<boolean | null> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        if (!imageModerationMissingKeyLogged) {
            imageModerationMissingKeyLogged = true;
            logger.warn('[Raid Protection] OPENAI_API_KEY is not configured; sexual-image classification is disabled. Spam and mass-action raid detection remain active.');
        }
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'omni-moderation-latest',
                input: [{
                    type: 'image_url',
                    image_url: { url: imageUrl },
                }],
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            logger.warn(`[Raid Protection] Image moderation returned HTTP ${response.status}.`);
            return null;
        }
        const body = await response.json().catch(() => null);
        if (!isRecord(body) || !Array.isArray(body.results) || !isRecord(body.results[0])) return null;
        const categories = isRecord(body.results[0].categories) ? body.results[0].categories : null;
        return categories?.sexual === true;
    } catch (error) {
        logger.warn(`[Raid Protection] Image moderation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function obscuredEvidence(imageUrl: string, messageId: string): Promise<AttachmentBuilder | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(imageUrl, { signal: controller.signal });
        if (!response.ok) return null;
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > IMAGE_MAX_BYTES) return null;
        const source = Buffer.from(await response.arrayBuffer());
        if (!source.length || source.length > IMAGE_MAX_BYTES) return null;

        // Deliberately destroy visual detail before storing evidence in Discord.
        const preview = await sharp(source, { animated: false, failOn: 'none' })
            .resize({ width: 48, height: 48, fit: 'inside', withoutEnlargement: false })
            .resize({ width: 640, height: 640, fit: 'inside', kernel: 'nearest' })
            .blur(8)
            .jpeg({ quality: 45 })
            .toBuffer();
        return new AttachmentBuilder(preview, { name: `obscured-evidence-${messageId}.jpg` });
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function handleImageSafety(message: Message): Promise<void> {
    if (!message.attachments.size || imageModerationInFlight.has(message.id)) return;
    const images = [...message.attachments.values()]
        .filter(attachment => isImageAttachment(attachment))
        .slice(0, MAX_IMAGES_PER_MESSAGE);
    if (!images.length) return;

    imageModerationInFlight.add(message.id);
    try {
        for (const attachment of images) {
            const sexual = await imageIsSexual(attachment.url);
            if (sexual !== true) continue;

            // Create obscured evidence before deleting the source message.
            const evidence = await obscuredEvidence(attachment.url, message.id);
            await message.delete().catch(() => undefined);
            const timedOut = await timeoutMember(message, 'Raid protection: sexual image content');

            const embed = new EmbedBuilder()
                .setColor(0xef4444)
                .setAuthor({ name: 'LARP Raid Protection', iconURL: message.author.displayAvatarURL() })
                .setTitle('🚨 Sexual Image Content Detected')
                .setDescription('The original image message was removed automatically. The attached evidence preview is intentionally obscured so explicit content is not redistributed.')
                .addFields(
                    { name: 'Member', value: `<@${message.author.id}>`, inline: true },
                    { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
                    { name: 'Filename', value: attachment.name ? `\`${attachment.name.slice(0, 180)}\`` : 'Unknown', inline: true },
                    { name: 'Automatic Action', value: timedOut ? '5-minute timeout applied' : 'Timeout could not be applied; check role hierarchy/permissions', inline: false },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();
            await sendRaidAlert(message.client, embed, evidence ? [evidence] : []);
            return;
        }
    } finally {
        imageModerationInFlight.delete(message.id);
    }
}

export async function handleRaidProtectionMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;
    await handleSpam(message);
    // If spam handling deleted the message, attachment URLs can still be usable for a
    // short time, but avoid unnecessary classifier requests for obvious spam bursts.
    await handleImageSafety(message);
}

export function registerRaidProtection(client: Client): void {
    client.on('guildMemberRemove', member => {
        void handleMemberRemoved(member).catch(error => {
            logger.warn(`[Raid Protection] Kick-burst check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on('guildBanAdd', ban => {
        void handleMemberBanned(ban).catch(error => {
            logger.warn(`[Raid Protection] Ban-burst check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on('messageCreate', message => {
        void handleRaidProtectionMessage(message).catch(error => {
            logger.warn(`[Raid Protection] Message safety check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    logger.info('[Raid Protection] Active: mass kick/ban bursts, spam raids, and sexual-image moderation are enabled when required Discord intents/API configuration are available.');
}
