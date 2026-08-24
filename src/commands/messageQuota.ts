import { createHash } from 'crypto';
import { resolve } from 'path';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND, INFRACTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import {
    MessageQuotaProfile,
    MessageQuotaWeek,
    QuotaAppeal,
    QuotaMessageEvent,
    type MessageQuotaProfileRecord,
    type MessageQuotaWeekRecord,
    type QuotaAppealRecord,
    type QuotaFailedMemberRecord,
    type QuotaRejectReason,
} from '../database/quotaModels';
import { detectProhibitedWords, detectRaidThreat } from '../events/messageModeration';
import { logger } from '../utils/logger';

const EASTERN_TIME_ZONE = 'America/New_York';
const QUOTA_LOG_CHANNEL_ID = '1539477750757466133';
const INFRACTION_PARENT_CHANNEL_ID = '1526044664975851642';
const INFRACTION_APPEAL_CHANNEL_ID = process.env.INFRACTION_APPEAL_CHANNEL_ID || '1537227443423682612';
const QUOTA_MANAGEMENT_ROLE_ID = '1521593407850680401';
const OWNERSHIP_ROLE_ID = '1521598108226818288';
const EXEMPT_AUTO_INFRACTION_ROLE_ID = '1521593407795888329';

// 1539477750757466133 was supplied as both the quota log channel and Mod role.
// Keep it as the requested log channel and use the previous Moderator role until
// QUOTA_MOD_ROLE_ID is configured with the corrected role ID.
const MOD_ROLE_ID = process.env.QUOTA_MOD_ROLE_ID || '1521593407795888336';

const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const INFRACTION_BANNER_NAME = 'infraction-banner.webp';
const INFRACTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', INFRACTION_BANNER_NAME);

const SCHEDULER_INTERVAL_MS = 60_000;
const FINALIZATION_LEASE_MS = 10 * 60_000;
const DUPLICATE_WINDOW_MS = 5 * 60_000;
const BURST_WINDOW_MS = 60_000;
const MIN_COUNTED_GAP_MS = 3_000;
const MAX_COUNTED_PER_MINUTE = 5;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const finalizingGuilds = new Set<string>();

interface QuotaRoleRule {
    roleId: string;
    roleName: string;
    required: number;
    autoInfractionExempt?: boolean;
}

interface ResolvedQuotaRule extends QuotaRoleRule {
    teamRules: QuotaRoleRule[];
}

/** Every configured team has its own valid-message requirement. */
export function quotaRoleRules(): QuotaRoleRule[] {
    return [
        { roleId: MOD_ROLE_ID, roleName: 'Moderator', required: 150 },
        { roleId: '1530363357423468706', roleName: 'Discord Moderation Team', required: 150 },
        { roleId: '1521593407804280967', roleName: 'Admin Team', required: 150 },
        { roleId: '1521593407816990811', roleName: 'Internal Affairs', required: 125 },
        { roleId: '1521593407816990819', roleName: 'Supervisory Team', required: 125 },
        { roleId: '1521593407741362259', roleName: 'Management', required: 125 },
        { roleId: '1521593407833640981', roleName: 'Head of Staff', required: 115 },
        { roleId: '1523164030448173206', roleName: 'Assistant Head of Staff', required: 115 },
        { roleId: '1534538735037972510', roleName: 'Community Manager', required: 115 },
        { roleId: '1523111129696702584', roleName: 'Board of Executives', required: 100 },
        { roleId: '1521593407833640986', roleName: 'Board of Directors', required: 75 },
        { roleId: OWNERSHIP_ROLE_ID, roleName: 'Ownership', required: 30, autoInfractionExempt: true },
    ];
}

interface EasternParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const easternFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

function easternParts(date: Date): EasternParts {
    const values: Record<string, number> = {};
    for (const part of easternFormatter.formatToParts(date)) {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    }
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second,
    };
}

function shiftLocalDate(year: number, month: number, day: number, days: number): Pick<EasternParts, 'year' | 'month' | 'day'> {
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function easternWallClockToUtc(parts: EasternParts): Date {
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let guess = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const represented = easternParts(new Date(guess));
        const representedUtc = Date.UTC(
            represented.year,
            represented.month - 1,
            represented.day,
            represented.hour,
            represented.minute,
            represented.second,
        );
        const correction = target - representedUtc;
        guess += correction;
        if (correction === 0) break;
    }
    return new Date(guess);
}

function nextFridayNineAmEastern(after: Date): Date {
    const local = easternParts(after);
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const daysUntilFriday = (5 - weekday + 7) % 7;
    let friday = shiftLocalDate(local.year, local.month, local.day, daysUntilFriday);
    let candidate = easternWallClockToUtc({ ...friday, hour: 9, minute: 0, second: 0 });
    if (candidate.getTime() <= after.getTime()) {
        friday = shiftLocalDate(friday.year, friday.month, friday.day, 7);
        candidate = easternWallClockToUtc({ ...friday, hour: 9, minute: 0, second: 0 });
    }
    return candidate;
}

function easternDateKey(date: Date): string {
    const local = easternParts(date);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function parseEasternDeadlineDate(value: string): Date | null {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
    return easternWallClockToUtc({ year, month, day, hour: 9, minute: 0, second: 0 });
}

function discordTimestamp(date: Date, style: 'F' | 'R' = 'F'): string {
    return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function panelSeparator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function mediaGallery(filename: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
    );
}

function underbannerAttachment() {
    return { attachment: UNDERBANNER_PATH, name: UNDERBANNER_NAME };
}

function infractionAttachments() {
    return [
        { attachment: INFRACTION_BANNER_PATH, name: INFRACTION_BANNER_NAME },
        underbannerAttachment(),
    ];
}

function safeText(value: string, max = 3_600): string {
    const cleaned = value.replace(/\u0000/gu, '').trim();
    return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function splitTextBlocks(lines: string[], maxLength = 3_500): string[] {
    const blocks: string[] = [];
    let current = '';
    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > maxLength && current) {
            blocks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

function buildSimpleQuotaPanel(title: string, body: string, accent = BRAND.color): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}\n${safeText(body, 3_700)}`),
        )
        .addSeparatorComponents(panelSeparator())
        .addMediaGalleryComponents(mediaGallery(UNDERBANNER_NAME));
}

function progressBar(count: number, required: number): string {
    const total = 10;
    const ratio = required > 0 ? Math.min(1, Math.max(0, count / required)) : 1;
    const filled = Math.round(ratio * total);
    return `${'▰'.repeat(filled)}${'▱'.repeat(total - filled)}`;
}

/**
 * A user's valid Discord message total counts toward every quota-team role they
 * hold. The effective total is the highest requirement among those teams,
 * because reaching that number necessarily completes every lower requirement.
 */
function quotaRequirementForMember(member: GuildMember): ResolvedQuotaRule | null {
    const teamRules = quotaRoleRules().filter(rule => member.roles.cache.has(rule.roleId));
    if (!teamRules.length) return null;

    const required = Math.max(...teamRules.map(rule => rule.required));
    return {
        roleId: teamRules.map(rule => rule.roleId).join(','),
        roleName: teamRules.map(rule => rule.roleName).join(' • '),
        required,
        autoInfractionExempt: teamRules.some(rule => rule.autoInfractionExempt),
        teamRules,
    };
}

function isAutoInfractionExempt(member: GuildMember, rule: ResolvedQuotaRule): boolean {
    return Boolean(rule.autoInfractionExempt)
        || member.roles.cache.has(OWNERSHIP_ROLE_ID)
        || member.roles.cache.has(EXEMPT_AUTO_INFRACTION_ROLE_ID);
}

function teamRequirementLines(rule: ResolvedQuotaRule, count: number): string[] {
    return rule.teamRules.map(team => {
        const complete = count >= team.required;
        return `${complete ? '✅' : '🕒'} **${team.roleName}:** ${count}/${team.required} valid messages`;
    });
}

function incompleteTeamSummary(rule: ResolvedQuotaRule, count: number): string {
    return rule.teamRules
        .filter(team => count < team.required)
        .map(team => `${team.roleName} (${count}/${team.required})`)
        .join(' • ');
}

function normalizeForQuotaHash(content: string): string {
    return content
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/https?:\/\/\S+/gu, '<url>')
        .replace(/<@!?\d+>/gu, '<user>')
        .replace(/<@&\d+>/gu, '<role>')
        .replace(/\b\d+\b/gu, '#')
        .replace(/[^\p{L}\p{N}#<>\s]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function quotaContentHash(content: string): string {
    return createHash('sha256').update(normalizeForQuotaHash(content)).digest('hex');
}

function highConfidenceTosViolation(content: string): boolean {
    const patterns = [
        /\b(?:doxx(?:ing)?|leak(?:ing)?\s+(?:someone(?:'s)?|their|your)\s+(?:address|phone|ip|private\s+info))\b/iu,
        /\b(?:token\s*grabber|phishing\s+link|steal(?:ing)?\s+(?:an?\s+)?account)\b/iu,
        /\b(?:threaten(?:ing)?\s+to\s+(?:seriously\s+)?harm\s+someone)\b/iu,
        /\b(?:share|post|send)\s+(?:private|personal)\s+(?:information|address|phone\s+number)\s+without\s+permission\b/iu,
    ];
    return patterns.some(pattern => pattern.test(content));
}

function rejectReasonForContent(content: string): QuotaRejectReason | null {
    if (/^\s*[!$?./][\p{L}\p{N}_-]+/u.test(content)) return 'Command';
    const normalized = normalizeForQuotaHash(content);
    const meaningfulCharacters = normalized.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (meaningfulCharacters < 4) return 'LowQuality';
    if (detectProhibitedWords(content).length > 0) return 'Profanity';
    if (highConfidenceTosViolation(content)) return 'TOS';
    if (detectRaidThreat(content)) return 'Raid';
    return null;
}

function recentAccepted(profile: MessageQuotaProfileRecord, now: number) {
    return (profile.recentAccepted || [])
        .filter(entry => now - new Date(entry.at).getTime() <= DUPLICATE_WINDOW_MS)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function spamRejectReason(profile: MessageQuotaProfileRecord, hash: string, now: number): QuotaRejectReason | null {
    const recent = recentAccepted(profile, now);
    if (recent.some(entry => entry.hash === hash)) return 'Spam';
    const latest = recent.at(-1);
    if (latest && now - new Date(latest.at).getTime() < MIN_COUNTED_GAP_MS) return 'Spam';
    const burst = recent.filter(entry => now - new Date(entry.at).getTime() <= BURST_WINDOW_MS);
    if (burst.length >= MAX_COUNTED_PER_MINUTE) return 'Spam';
    return null;
}

async function sendQuotaLog(client: Client, title: string, body: string, accent = BRAND.color): Promise<void> {
    const channel = await client.channels.fetch(QUOTA_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[Quota] Log channel ${QUOTA_LOG_CHANNEL_ID} is unavailable.`);
        return;
    }
    await channel.send({
        components: [buildSimpleQuotaPanel(title, body, accent)],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(error => {
        logger.warn(`[Quota] Could not send quota log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function createNewWeek(client: Client, guildId: string, now: Date): Promise<MessageQuotaWeekRecord | null> {
    const deadline = nextFridayNineAmEastern(now);
    const weekKey = easternDateKey(deadline);
    try {
        const created = await MessageQuotaWeek.create({
            guildId,
            weekKey,
            startedAt: now,
            deadlineAt: deadline,
            originalDeadlineAt: deadline,
            status: 'Active',
            extensionCount: 0,
            failedMembers: [],
            exemptMissedUserIds: [],
            createdAt: now,
            updatedAt: now,
        });
        const record = created.toObject() as unknown as MessageQuotaWeekRecord;
        await sendQuotaLog(
            client,
            '📊 Weekly Message Quota Started',
            [
                `**Week:** \`${weekKey}\``,
                `**Started:** ${discordTimestamp(now)}`,
                `**Deadline:** ${discordTimestamp(deadline)} (${EASTERN_TIME_ZONE})`,
                '**Every Team Counts:** every quota-team role a staff member holds is evaluated from their valid Discord message total.',
                '**Validity:** spam, prohibited language, high-confidence TOS violations, raid content, command farming, and low-quality filler do not count.',
            ].join('\n'),
        );
        return record;
    } catch (error) {
        const existing = await MessageQuotaWeek.findOne({ guildId, status: 'Active' }).sort({ startedAt: -1 }).lean().exec().catch(() => null);
        if (existing) return existing as unknown as MessageQuotaWeekRecord;
        logger.warn(`[Quota] Could not create week ${weekKey}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}

async function ensureActiveWeek(client: Client, guildId: string, now = new Date()): Promise<MessageQuotaWeekRecord | null> {
    if (!isDatabaseAvailable()) return null;

    let active = await MessageQuotaWeek.findOne({ guildId, status: { $in: ['Active', 'Finalizing'] } })
        .sort({ startedAt: -1 })
        .lean().exec().catch(() => null) as unknown as MessageQuotaWeekRecord | null;

    if (active?.status === 'Finalizing') {
        const lease = active.finalizationLeaseUntil ? new Date(active.finalizationLeaseUntil) : null;
        if (lease && lease.getTime() > now.getTime()) return null;
        await MessageQuotaWeek.updateOne(
            { guildId, weekKey: active.weekKey, status: 'Finalizing' },
            { $set: { status: 'Active', updatedAt: now }, $unset: { finalizationLeaseUntil: 1 } },
        ).exec().catch(() => undefined);
        active = await MessageQuotaWeek.findOne({ guildId, weekKey: active.weekKey, status: 'Active' }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
    }

    if (active?.status === 'Active' && new Date(active.deadlineAt).getTime() <= now.getTime()) {
        const ended = await finalizeQuotaWeek(
            client,
            guildId,
            active.weekKey,
            client.user?.id || 'system',
            'Scheduled weekly quota deadline reached.',
            false,
        );
        if (!ended || ended.status !== 'Ended') return null;
        active = null;
    }

    if (active?.status === 'Active') return active;

    const latestEnded = await MessageQuotaWeek.findOne({ guildId, status: 'Ended' })
        .sort({ endedAt: -1, updatedAt: -1 })
        .lean().exec().catch(() => null) as unknown as MessageQuotaWeekRecord | null;
    if (latestEnded?.nextStartAt && new Date(latestEnded.nextStartAt).getTime() > now.getTime()) return null;

    return createNewWeek(client, guildId, now);
}

async function loadOrCreateProfile(
    guildId: string,
    userId: string,
    username: string,
    weekKey: string,
    rule: ResolvedQuotaRule,
): Promise<MessageQuotaProfileRecord | null> {
    const now = new Date();
    const profile = await MessageQuotaProfile.findOneAndUpdate(
        { guildId, userId, weekKey },
        {
            $setOnInsert: {
                guildId,
                userId,
                weekKey,
                count: 0,
                completionNotifiedRequirement: 0,
                completionLoggedRequirement: 0,
                recentAccepted: [],
                rejected: { spam: 0, profanity: 0, tos: 0, raid: 0, lowQuality: 0, command: 0 },
                createdAt: now,
            },
            $set: {
                username,
                required: rule.required,
                roleId: rule.roleId,
                roleName: rule.roleName,
                updatedAt: now,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec().catch(error => {
        logger.warn(`[Quota] Could not load profile for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });
    return profile as unknown as MessageQuotaProfileRecord | null;
}

function rejectCounterPath(reason: QuotaRejectReason): string {
    switch (reason) {
        case 'Spam': return 'rejected.spam';
        case 'Profanity': return 'rejected.profanity';
        case 'TOS': return 'rejected.tos';
        case 'Raid': return 'rejected.raid';
        case 'LowQuality': return 'rejected.lowQuality';
        case 'Command': return 'rejected.command';
    }
}

async function tryAutoBanHighConfidenceRaid(message: Message): Promise<void> {
    const detection = detectRaidThreat(message.content);
    if (!detection || detection.confidence !== 'High' || !message.guild) return;
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member || !member.bannable) {
        await sendQuotaLog(
            message.client,
            '🚨 High-Confidence Raid Message Detected',
            `A high-confidence raid message from <@${message.author.id}> was excluded from quota, but the bot could not automatically ban the account. Staff review is required.`,
            0xef4444,
        );
        return;
    }
    await member.ban({ reason: 'Automated safety action: high-confidence Discord raid threat.' }).catch(async error => {
        logger.warn(`[Quota] Raid auto-ban failed for ${member.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await sendQuotaLog(
            message.client,
            '🚨 Raid Auto-Ban Failed',
            `The bot detected a high-confidence raid threat from <@${member.id}>, excluded the message from quota, but Discord rejected the automatic ban.`,
            0xef4444,
        );
    });
}

async function maybeNotifyCompletion(
    client: Client,
    profile: MessageQuotaProfileRecord,
    week: MessageQuotaWeekRecord,
    rule?: ResolvedQuotaRule,
): Promise<void> {
    if (profile.count < profile.required) return;

    const roleBreakdown = rule
        ? teamRequirementLines(rule, profile.count)
        : [`✅ **Tracked Teams:** ${profile.roleName}`];

    if ((profile.completionNotifiedRequirement || 0) < profile.required) {
        const claimed = await MessageQuotaProfile.findOneAndUpdate(
            {
                guildId: profile.guildId,
                userId: profile.userId,
                weekKey: profile.weekKey,
                completionNotifiedRequirement: { $lt: profile.required },
            },
            { $set: { completionNotifiedRequirement: profile.required, updatedAt: new Date() } },
            { new: true },
        ).lean().exec().catch(() => null);

        if (claimed) {
            const user = await client.users.fetch(profile.userId).catch(() => null);
            if (user) {
                const delivered = await user.send({
                    components: [buildSimpleQuotaPanel(
                        '✅ All Team Quotas Completed',
                        [
                            `You completed **every weekly message quota team you currently hold** for week \`${profile.weekKey}\`.`,
                            '',
                            ...roleBreakdown,
                            '',
                            `**Valid Messages:** ${profile.count}`,
                            `**Required to satisfy all teams:** ${profile.required}`,
                            `**Deadline:** ${discordTimestamp(new Date(week.deadlineAt))}`,
                            '',
                            'Only valid messages counted. Spam, prohibited language, TOS violations, raid content, commands, and message farming were excluded.',
                        ].join('\n'),
                        0x22c55e,
                    )],
                    files: [underbannerAttachment()],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                }).then(() => true).catch(() => false);

                if (!delivered) {
                    await MessageQuotaProfile.updateOne(
                        { guildId: profile.guildId, userId: profile.userId, weekKey: profile.weekKey, completionNotifiedRequirement: profile.required },
                        { $set: { completionNotifiedRequirement: 0, updatedAt: new Date() } },
                    ).exec().catch(() => undefined);
                }
            }
        }
    }

    if ((profile.completionLoggedRequirement || 0) < profile.required) {
        const claimed = await MessageQuotaProfile.findOneAndUpdate(
            {
                guildId: profile.guildId,
                userId: profile.userId,
                weekKey: profile.weekKey,
                completionLoggedRequirement: { $lt: profile.required },
            },
            { $set: { completionLoggedRequirement: profile.required, updatedAt: new Date() } },
            { new: true },
        ).lean().exec().catch(() => null);
        if (claimed) {
            await sendQuotaLog(
                client,
                '✅ Staff Completed Every Team Quota',
                [
                    `**Member:** <@${profile.userId}>`,
                    `**Teams:** ${profile.roleName}`,
                    `**Week:** \`${profile.weekKey}\``,
                    `**Valid Messages:** ${profile.count}/${profile.required}`,
                    `**Completed:** ${discordTimestamp(new Date())}`,
                ].join('\n'),
                0x22c55e,
            );
        }
    }
}

/** Counts a valid Discord message once; that count applies to every team the member holds. */
export async function handleQuotaMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId || !message.content.trim()) return;
    if (message.channelId === QUOTA_LOG_CHANNEL_ID || !isDatabaseAvailable()) return;

    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    const rule = quotaRequirementForMember(member);
    if (!rule) return;

    const week = await ensureActiveWeek(message.client, message.guild.id, message.createdAt);
    if (!week) return;

    const profile = await loadOrCreateProfile(
        message.guild.id,
        message.author.id,
        message.author.username,
        week.weekKey,
        rule,
    );
    if (!profile) return;

    const hash = quotaContentHash(message.content);
    const now = message.createdTimestamp || Date.now();
    let rejectReason = rejectReasonForContent(message.content);
    if (!rejectReason) rejectReason = spamRejectReason(profile, hash, now);

    try {
        await QuotaMessageEvent.create({
            messageId: message.id,
            guildId: message.guild.id,
            channelId: message.channelId,
            userId: message.author.id,
            weekKey: week.weekKey,
            decision: rejectReason ? 'Rejected' : 'Accepted',
            rejectReason: rejectReason || undefined,
            contentHash: hash,
            createdAt: message.createdAt,
        });
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) return;
        logger.warn(`[Quota] Could not reserve message ${message.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return;
    }

    try {
        if (rejectReason) {
            await MessageQuotaProfile.updateOne(
                { guildId: message.guild.id, userId: message.author.id, weekKey: week.weekKey },
                {
                    $inc: { [rejectCounterPath(rejectReason)]: 1 },
                    $set: {
                        username: message.author.username,
                        required: rule.required,
                        roleId: rule.roleId,
                        roleName: rule.roleName,
                        updatedAt: new Date(),
                    },
                },
            ).exec();
            if (rejectReason === 'Raid') await tryAutoBanHighConfidenceRaid(message);
            return;
        }

        const updated = await MessageQuotaProfile.findOneAndUpdate(
            { guildId: message.guild.id, userId: message.author.id, weekKey: week.weekKey },
            {
                $inc: { count: 1 },
                $push: {
                    recentAccepted: {
                        $each: [{ hash, at: message.createdAt }],
                        $slice: -12,
                    },
                },
                $set: {
                    username: message.author.username,
                    required: rule.required,
                    roleId: rule.roleId,
                    roleName: rule.roleName,
                    updatedAt: new Date(),
                },
            },
            { new: true },
        ).lean().exec();

        if (!updated) throw new Error('Quota profile disappeared during message update.');
        await maybeNotifyCompletion(
            message.client,
            updated as unknown as MessageQuotaProfileRecord,
            week,
            rule,
        );
    } catch (error) {
        await QuotaMessageEvent.deleteOne({ messageId: message.id }).exec().catch(() => undefined);
        logger.warn(`[Quota] Failed to apply message ${message.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

function failureStatusLabel(entry: QuotaFailedMemberRecord): string {
    switch (entry.appealStatus) {
        case 'Approved': return '✅ Appeal Approved';
        case 'Pending': return '🕒 Appeal Pending';
        case 'Denied': return '❌ Appeal Denied';
        default: return '⚠️ Active Infraction';
    }
}

function buildWeeklyInfractionPanel(week: MessageQuotaWeekRecord): ContainerBuilder {
    const panel = new ContainerBuilder()
        .setAccentColor(0xef4444)
        .addMediaGalleryComponents(mediaGallery(INFRACTION_BANNER_NAME))
        .addSeparatorComponents(panelSeparator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⚖️ Weekly Message Quota Infraction',
            `> **Week:** \`${week.weekKey}\``,
            `> **Deadline:** ${discordTimestamp(new Date(week.deadlineAt))}`,
            '> Every staff team role is evaluated using valid Discord messages.',
            '> The following staff members did not satisfy one or more team quotas before the deadline.',
            '> This is one shared weekly infraction. Each listed member may appeal their own entry.',
        ].join('\n')));

    const lines = week.failedMembers.map((entry, index) =>
        `${index + 1}. <@${entry.userId}> — **${entry.roleName}** — Required max: \`${entry.count}/${entry.required}\` — ${failureStatusLabel(entry)}`,
    );
    for (const block of splitTextBlocks(lines)) {
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    }

    panel.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`quota:appeal:${week.weekKey}`)
                .setLabel('⚖️ Appeal Quota Infraction')
                .setStyle(ButtonStyle.Primary),
        ),
    );

    return panel
        .addSeparatorComponents(panelSeparator())
        .addMediaGalleryComponents(mediaGallery(UNDERBANNER_NAME));
}

async function refreshWeeklyInfractionPanel(client: Client, week: MessageQuotaWeekRecord): Promise<void> {
    if (!week.finalChannelId || !week.finalMessageId) return;
    const channel = await client.channels.fetch(week.finalChannelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(week.finalMessageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [buildWeeklyInfractionPanel(week)],
        attachments: Array.from(message.attachments.values()),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(error => {
        logger.warn(`[Quota] Could not refresh weekly infraction ${week.weekKey}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

function buildQuotaAppealReviewPanel(appeal: QuotaAppealRecord): ContainerBuilder {
    const accent = appeal.status === 'Approved' ? 0x22c55e : appeal.status === 'Denied' ? 0xef4444 : BRAND.color;
    const panel = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⚖️ Quota Infraction Appeal',
            `> **Appeal ID:** \`${appeal.appealId}\``,
            `> **Week:** \`${appeal.weekKey}\``,
            `> **Member:** <@${appeal.userId}> • \`${appeal.username}\``,
            `> **Status:** **${appeal.status}**`,
            `> **Reason:** ${safeText(appeal.reason, 1_500)}`,
            appeal.reviewedById ? `> **Reviewed By:** <@${appeal.reviewedById}>` : null,
            appeal.reviewReason ? `> **Review Reason:** ${safeText(appeal.reviewReason, 1_000)}` : null,
        ].filter(Boolean).join('\n')));

    if (appeal.status === 'Pending') {
        panel.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`quota:appeal-review:approve:${appeal.appealId}`)
                    .setLabel('Approve Appeal')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`quota:appeal-review:deny:${appeal.appealId}`)
                    .setLabel('Deny Appeal')
                    .setStyle(ButtonStyle.Danger),
            ),
        );
    }

    return panel
        .addSeparatorComponents(panelSeparator())
        .addMediaGalleryComponents(mediaGallery(UNDERBANNER_NAME));
}

async function postWeeklyInfraction(
    client: Client,
    week: MessageQuotaWeekRecord,
): Promise<{ channelId: string; messageId: string; url: string } | null> {
    if (!week.failedMembers.length) return null;
    const channel = await client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) throw new Error(`Infraction channel ${INFRACTION_PARENT_CHANNEL_ID} is unavailable.`);
    const message = await channel.send({
        components: [buildWeeklyInfractionPanel(week)],
        files: infractionAttachments(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    return { channelId: channel.id, messageId: message.id, url: message.url };
}

async function notifyFailedMembers(client: Client, week: MessageQuotaWeekRecord, infractionUrl: string | null): Promise<void> {
    await Promise.allSettled(week.failedMembers.map(async entry => {
        const user = await client.users.fetch(entry.userId).catch(() => null);
        if (!user) return;
        await user.send({
            components: [buildSimpleQuotaPanel(
                '⚠️ Weekly Team Quota Not Completed',
                [
                    `You finished week \`${week.weekKey}\` with **${entry.count} valid messages**.`,
                    `**Incomplete team quota(s):** ${entry.roleName}`,
                    `**Highest required total:** ${entry.required}`,
                    'A weekly quota infraction was issued.',
                    infractionUrl ? `**Infraction:** ${infractionUrl}` : '',
                    '',
                    'The weekly infraction is appealable using the **Appeal Quota Infraction** button on the shared weekly emblem.',
                ].filter(Boolean).join('\n'),
                0xef4444,
            )],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    }));
}

export async function finalizeQuotaWeek(
    client: Client,
    guildId: string,
    weekKey: string,
    endedById: string,
    endedReason: string,
    manualEarlyEnd: boolean,
): Promise<MessageQuotaWeekRecord | null> {
    if (!isDatabaseAvailable() || finalizingGuilds.has(guildId)) return null;
    finalizingGuilds.add(guildId);
    const now = new Date();

    try {
        const claimed = await MessageQuotaWeek.findOneAndUpdate(
            {
                guildId,
                weekKey,
                $or: [
                    { status: 'Active' },
                    { status: 'Finalizing', finalizationLeaseUntil: { $lte: now } },
                ],
            },
            {
                $set: {
                    status: 'Finalizing',
                    finalizationLeaseUntil: new Date(now.getTime() + FINALIZATION_LEASE_MS),
                    updatedAt: now,
                },
            },
            { new: true },
        ).lean().exec();

        if (!claimed) {
            return await MessageQuotaWeek.findOne({ guildId, weekKey }).lean().exec()
                .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        }
        const week = claimed as unknown as MessageQuotaWeekRecord;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) throw new Error(`Guild ${guildId} is unavailable.`);
        const members = await guild.members.fetch().catch(error => {
            throw new Error(`Could not fetch complete guild member list: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });

        const profiles = await MessageQuotaProfile.find({ guildId, weekKey }).lean().exec();
        const profileByUser = new Map(
            profiles.map(profile => [String(profile.userId), profile as unknown as MessageQuotaProfileRecord]),
        );

        const failedMembers: QuotaFailedMemberRecord[] = [];
        const exemptMissedUserIds: string[] = [];
        let evaluated = 0;
        let completed = 0;

        for (const member of members.values()) {
            if (member.user.bot) continue;
            const rule = quotaRequirementForMember(member);
            if (!rule) continue;

            evaluated += 1;
            const profile = profileByUser.get(member.id);
            const count = Math.max(0, profile?.count || 0);
            const incompleteTeams = incompleteTeamSummary(rule, count);

            if (!incompleteTeams) {
                completed += 1;
                continue;
            }

            if (isAutoInfractionExempt(member, rule)) {
                exemptMissedUserIds.push(member.id);
                continue;
            }

            failedMembers.push({
                userId: member.id,
                username: member.user.username,
                roleId: rule.roleId,
                roleName: incompleteTeams,
                count,
                required: rule.required,
                appealStatus: 'Active',
            });
        }

        await MessageQuotaWeek.updateOne(
            { guildId, weekKey, status: 'Finalizing' },
            { $set: { failedMembers, exemptMissedUserIds, updatedAt: new Date() } },
        ).exec();
        week.failedMembers = failedMembers;
        week.exemptMissedUserIds = exemptMissedUserIds;

        let infractionUrl: string | null = null;
        if (failedMembers.length > 0) {
            if (week.finalChannelId && week.finalMessageId) {
                const existingChannel = await client.channels.fetch(week.finalChannelId).catch(() => null);
                if (existingChannel?.isTextBased() && 'messages' in existingChannel) {
                    const existingMessage = await existingChannel.messages.fetch(week.finalMessageId).catch(() => null);
                    infractionUrl = existingMessage?.url || null;
                }
            }

            if (!infractionUrl) {
                const posted = await postWeeklyInfraction(client, week);
                if (!posted) throw new Error('Weekly infraction was required but could not be posted.');
                week.finalChannelId = posted.channelId;
                week.finalMessageId = posted.messageId;
                infractionUrl = posted.url;
                await MessageQuotaWeek.updateOne(
                    { guildId, weekKey, status: 'Finalizing' },
                    { $set: { finalChannelId: posted.channelId, finalMessageId: posted.messageId, updatedAt: new Date() } },
                ).exec();
            }
        }

        const originalDeadline = new Date(week.originalDeadlineAt);
        const nextStartAt = manualEarlyEnd && now.getTime() < originalDeadline.getTime()
            ? originalDeadline
            : now;

        const ended = await MessageQuotaWeek.findOneAndUpdate(
            { guildId, weekKey, status: 'Finalizing' },
            {
                $set: {
                    status: 'Ended',
                    endedAt: now,
                    endedById,
                    endedReason,
                    nextStartAt,
                    failedMembers,
                    exemptMissedUserIds,
                    updatedAt: now,
                },
                $unset: { finalizationLeaseUntil: 1 },
            },
            { new: true },
        ).lean().exec();

        if (!ended) throw new Error('Could not mark the quota week ended after evaluation.');
        const endedWeek = ended as unknown as MessageQuotaWeekRecord;

        await sendQuotaLog(
            client,
            failedMembers.length ? '⚖️ Weekly Team Quotas Finalized' : '✅ Weekly Team Quotas Finalized — Everyone Passed',
            [
                `**Week:** \`${weekKey}\``,
                `**Ended:** ${discordTimestamp(now)}`,
                `**Ended By:** <@${endedById}>`,
                `**Reason:** ${safeText(endedReason, 800)}`,
                `**Staff Evaluated:** ${evaluated}`,
                `**Completed Every Team Quota:** ${completed}`,
                `**Auto-Infracted:** ${failedMembers.length}`,
                `**Missed but Exempt:** ${exemptMissedUserIds.length}`,
                infractionUrl ? `**Weekly Infraction:** ${infractionUrl}` : '**Weekly Infraction:** None required',
                exemptMissedUserIds.length
                    ? `**Exempt Accounts:** ${exemptMissedUserIds.map(id => `<@${id}>`).join(' • ')}`
                    : '',
            ].filter(Boolean).join('\n'),
            failedMembers.length ? 0xef4444 : 0x22c55e,
        );

        if (failedMembers.length) await notifyFailedMembers(client, endedWeek, infractionUrl);
        return endedWeek;
    } catch (error) {
        logger.error(`[Quota] Finalization failed for ${guildId}/${weekKey}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await MessageQuotaWeek.updateOne(
            { guildId, weekKey, status: 'Finalizing' },
            { $set: { status: 'Active', updatedAt: new Date() }, $unset: { finalizationLeaseUntil: 1 } },
        ).exec().catch(() => undefined);
        return null;
    } finally {
        finalizingGuilds.delete(guildId);
    }
}

async function hasExactRole(
    interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
    roleId: string,
): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id && roleId === OWNERSHIP_ROLE_ID) return true;
    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(roleId)) return true;
    if (member && Array.isArray(member.roles) && member.roles.includes(roleId)) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(roleId));
}

async function canReviewQuotaAppeal(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    return hasExactRole(interaction, INFRACTION_AUTHORIZED_ROLE_ID);
}

async function quotaForUser(client: Client, guildId: string, userId: string): Promise<{
    member: GuildMember;
    rule: ResolvedQuotaRule;
    week: MessageQuotaWeekRecord;
    profile: MessageQuotaProfileRecord;
} | null> {
    if (!isDatabaseAvailable()) return null;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    const rule = quotaRequirementForMember(member);
    if (!rule) return null;
    const week = await ensureActiveWeek(client, guildId);
    if (!week) return null;
    const profile = await loadOrCreateProfile(guildId, userId, member.user.username, week.weekKey, rule);
    if (!profile) return null;
    if (profile.count >= rule.required) await maybeNotifyCompletion(client, profile, week, rule);
    return { member, rule, week, profile };
}

function quotaViewBody(
    member: GuildMember,
    rule: ResolvedQuotaRule,
    week: MessageQuotaWeekRecord,
    profile: MessageQuotaProfileRecord,
    showFiltered: boolean,
): string {
    const remaining = Math.max(0, rule.required - profile.count);
    const complete = remaining === 0;
    const lines = [
        `**Member:** <@${member.id}>`,
        `**Week:** \`${week.weekKey}\``,
        '',
        '**Every Team Quota**',
        ...teamRequirementLines(rule, profile.count),
        '',
        `**Valid Messages:** ${profile.count}`,
        `**Messages Needed To Complete Every Team:** ${remaining}`,
        `**Highest Team Requirement:** ${rule.required}`,
        `**Overall Progress:** ${progressBar(profile.count, rule.required)} ${Math.min(100, Math.floor((profile.count / rule.required) * 100))}%`,
        `**Overall Status:** ${complete ? '✅ Every team complete' : '🕒 One or more team quotas still incomplete'}`,
        `**Deadline:** ${discordTimestamp(new Date(week.deadlineAt))} • ${discordTimestamp(new Date(week.deadlineAt), 'R')}`,
    ];

    if (showFiltered) {
        lines.push(
            '',
            '**Filtered Messages This Week**',
            `Spam: ${profile.rejected?.spam || 0} • Profanity: ${profile.rejected?.profanity || 0} • TOS: ${profile.rejected?.tos || 0} • Raid: ${profile.rejected?.raid || 0}`,
            `Low-quality/filler: ${profile.rejected?.lowQuality || 0} • Commands: ${profile.rejected?.command || 0}`,
        );
    }

    if (isAutoInfractionExempt(member, rule)) {
        lines.push('', '🛡️ **Auto-Infraction Exempt:** Quota is still tracked, but this account will not receive the automatic Friday quota infraction.');
    }
    return lines.join('\n');
}

async function replyV2(
    interaction: ChatInputCommandInteraction,
    title: string,
    body: string,
    accent = BRAND.color,
): Promise<void> {
    await interaction.reply({
        components: [buildSimpleQuotaPanel(title, body, accent)],
        files: [underbannerAttachment()],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

const viewMyQuotaCommand = {
    data: new SlashCommandBuilder()
        .setName('view-my-quota')
        .setDescription('View every weekly team message quota you currently have'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in the server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const result = await quotaForUser(interaction.client, interaction.guildId, interaction.user.id);
        if (!result) {
            await replyV2(
                interaction,
                '📊 My Weekly Team Quotas',
                isDatabaseAvailable()
                    ? 'You do not currently have any tracked quota-team roles, or there is no active quota period right now.'
                    : 'The quota database is temporarily unavailable. Counts are paused rather than risking incorrect totals.',
            );
            return;
        }
        await replyV2(
            interaction,
            '📊 My Weekly Team Quotas',
            quotaViewBody(result.member, result.rule, result.week, result.profile, false),
        );
    },
};

const viewUserQuotaCommand = {
    data: new SlashCommandBuilder()
        .setName('view-user-quota')
        .setDescription('Ownership only: view every team quota for another staff member')
        .addUserOption(option => option.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId || !await hasExactRole(interaction, OWNERSHIP_ROLE_ID)) {
            await interaction.reply({ content: `You need <@&${OWNERSHIP_ROLE_ID}> to use this command.`, flags: MessageFlags.Ephemeral });
            return;
        }
        const user = interaction.options.getUser('user', true);
        const result = await quotaForUser(interaction.client, interaction.guildId, user.id);
        if (!result) {
            await replyV2(interaction, '🔎 User Team Quotas', 'That user does not currently have a tracked quota-team role, or there is no active quota period.');
            return;
        }
        await replyV2(
            interaction,
            '🔎 User Team Quotas',
            quotaViewBody(result.member, result.rule, result.week, result.profile, true),
        );
    },
};

const endWeeklyQuotaEarlyCommand = {
    data: new SlashCommandBuilder()
        .setName('end-weekly-quota-early')
        .setDescription('Quota management only: evaluate every team quota immediately')
        .addStringOption(option => option
            .setName('confirm')
            .setDescription('Confirm the immediate weekly evaluation')
            .setRequired(true)
            .addChoices({ name: 'Yes — end and evaluate now', value: 'CONFIRM' }))
        .addStringOption(option => option.setName('reason').setDescription('Reason for ending the week early').setMaxLength(500)),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId || !await hasExactRole(interaction, QUOTA_MANAGEMENT_ROLE_ID)) {
            await interaction.reply({ content: `You need <@&${QUOTA_MANAGEMENT_ROLE_ID}> to use this command.`, flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const active = await MessageQuotaWeek.findOne({ guildId: interaction.guildId, status: 'Active' }).sort({ startedAt: -1 }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        if (!active) {
            await interaction.editReply('There is no active quota week to end.');
            return;
        }
        const reason = interaction.options.getString('reason') || 'Quota management ended the weekly quota early.';
        const ended = await finalizeQuotaWeek(interaction.client, interaction.guildId, active.weekKey, interaction.user.id, reason, true);
        if (!ended || ended.status !== 'Ended') {
            await interaction.editReply('The quota week could not be finalized safely. No incomplete-team infractions were issued from an incomplete evaluation.');
            return;
        }
        await interaction.editReply(`✅ Week ${ended.weekKey} ended early. ${ended.failedMembers.length} non-exempt staff member(s) did not complete every team quota.`);
    },
};

const extendWeeksQuotaCommand = {
    data: new SlashCommandBuilder()
        .setName('extend-weeks-quota')
        .setDescription('Quota management only: move this week’s deadline to another date at 9 AM New York time')
        .addStringOption(option => option
            .setName('date')
            .setDescription('New deadline date in YYYY-MM-DD format')
            .setRequired(true)
            .setMaxLength(10))
        .addStringOption(option => option.setName('reason').setDescription('Reason for extending this week').setMaxLength(500)),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId || !await hasExactRole(interaction, QUOTA_MANAGEMENT_ROLE_ID)) {
            await interaction.reply({ content: `You need <@&${QUOTA_MANAGEMENT_ROLE_ID}> to use this command.`, flags: MessageFlags.Ephemeral });
            return;
        }
        const requestedDate = interaction.options.getString('date', true);
        const deadline = parseEasternDeadlineDate(requestedDate);
        if (!deadline) {
            await interaction.reply({ content: 'Use a real date in `YYYY-MM-DD` format, for example `2026-08-24`.', flags: MessageFlags.Ephemeral });
            return;
        }
        const active = await MessageQuotaWeek.findOne({ guildId: interaction.guildId, status: 'Active' }).sort({ startedAt: -1 }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        if (!active) {
            await interaction.reply({ content: 'There is no active quota week to extend.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (deadline.getTime() <= new Date(active.deadlineAt).getTime()) {
            await interaction.reply({ content: `The new deadline must be later than the current deadline (${discordTimestamp(new Date(active.deadlineAt))}).`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (deadline.getTime() <= Date.now()) {
            await interaction.reply({ content: 'The new quota deadline must be in the future.', flags: MessageFlags.Ephemeral });
            return;
        }

        const reason = interaction.options.getString('reason') || 'Quota management extended the weekly deadline.';
        const updated = await MessageQuotaWeek.findOneAndUpdate(
            { guildId: interaction.guildId, weekKey: active.weekKey, status: 'Active' },
            {
                $set: {
                    deadlineAt: deadline,
                    extendedById: interaction.user.id,
                    extensionReason: reason,
                    updatedAt: new Date(),
                },
                $inc: { extensionCount: 1 },
            },
            { new: true },
        ).lean().exec().catch(() => null) as unknown as MessageQuotaWeekRecord | null;

        if (!updated) {
            await interaction.reply({ content: 'The quota deadline changed while this command was running. Please try again.', flags: MessageFlags.Ephemeral });
            return;
        }

        await sendQuotaLog(
            interaction.client,
            '🗓️ Weekly Team Quotas Extended',
            [
                `**Week:** \`${updated.weekKey}\``,
                `**Changed By:** <@${interaction.user.id}>`,
                `**Previous Deadline:** ${discordTimestamp(new Date(active.deadlineAt))}`,
                `**New Deadline:** ${discordTimestamp(deadline)} (${EASTERN_TIME_ZONE})`,
                `**Reason:** ${safeText(reason, 800)}`,
            ].join('\n'),
            0xf59e0b,
        );
        await interaction.reply({ content: `✅ Week ${updated.weekKey} now ends ${discordTimestamp(deadline)}.`, flags: MessageFlags.Ephemeral });
    },
};

export const messageQuotaCommands = [
    viewMyQuotaCommand,
    viewUserQuotaCommand,
    endWeeklyQuotaEarlyCommand,
    extendWeeksQuotaCommand,
];

function quotaAppealModal(weekKey: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`quota:appeal-modal:${weekKey}`)
        .setTitle('Appeal Weekly Quota Infraction')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Why should this quota infraction be appealed?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(10)
                    .setMaxLength(1_500),
            ),
        );
}

function quotaDecisionModal(action: 'approve' | 'deny', appealId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`quota:appeal-decision:${action}:${appealId}`)
        .setTitle(action === 'approve' ? 'Approve Quota Appeal' : 'Deny Quota Appeal')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Review reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(1_000),
            ),
        );
}

function generateAppealId(): string {
    return `QA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function handleMessageQuotaButton(interaction: ButtonInteraction): Promise<boolean> {
    const appealStart = interaction.customId.match(/^quota:appeal:(\d{4}-\d{2}-\d{2})$/u);
    if (appealStart) {
        if (!interaction.guildId || !isDatabaseAvailable()) {
            await interaction.reply({ content: 'The quota appeal database is temporarily unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const week = await MessageQuotaWeek.findOne({ guildId: interaction.guildId, weekKey: appealStart[1], status: 'Ended' }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        const entry = week?.failedMembers.find(item => item.userId === interaction.user.id);
        if (!week || !entry) {
            await interaction.reply({ content: 'You are not listed on this weekly quota infraction.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (entry.appealStatus !== 'Active') {
            const statusText = entry.appealStatus === 'Pending'
                ? 'Your quota appeal is already pending review.'
                : entry.appealStatus === 'Approved'
                    ? 'Your quota appeal was already approved.'
                    : 'Your quota appeal was already reviewed and denied.';
            await interaction.reply({ content: statusText, flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(quotaAppealModal(week.weekKey));
        return true;
    }

    const review = interaction.customId.match(/^quota:appeal-review:(approve|deny):(QA-[A-Z0-9-]+)$/u);
    if (review) {
        if (!await canReviewQuotaAppeal(interaction)) {
            await interaction.reply({ content: `You need <@&${INFRACTION_AUTHORIZED_ROLE_ID}> to review quota appeals.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(quotaDecisionModal(review[1] as 'approve' | 'deny', review[2]));
        return true;
    }

    return false;
}

export async function handleMessageQuotaModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const appealSubmit = interaction.customId.match(/^quota:appeal-modal:(\d{4}-\d{2}-\d{2})$/u);
    if (appealSubmit) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.guildId || !isDatabaseAvailable()) {
            await interaction.editReply('The quota appeal database is temporarily unavailable.');
            return true;
        }

        const week = await MessageQuotaWeek.findOne({ guildId: interaction.guildId, weekKey: appealSubmit[1], status: 'Ended' }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        const entry = week?.failedMembers.find(item => item.userId === interaction.user.id);
        if (!week || !entry || entry.appealStatus !== 'Active') {
            await interaction.editReply('This quota infraction is not currently eligible for a new appeal from your account.');
            return true;
        }

        const appealId = generateAppealId();
        const reason = interaction.fields.getTextInputValue('reason').trim();
        let appeal: QuotaAppealRecord;

        try {
            const created = await QuotaAppeal.create({
                appealId,
                guildId: interaction.guildId,
                weekKey: week.weekKey,
                userId: interaction.user.id,
                username: interaction.user.username,
                reason,
                status: 'Pending',
                reviewMessageId: '',
                reviewChannelId: '',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            appeal = created.toObject() as unknown as QuotaAppealRecord;
        } catch (error) {
            if ((error as { code?: number })?.code === 11000) {
                await interaction.editReply('You already submitted a quota appeal for this week.');
                return true;
            }
            throw error;
        }

        const marked = await MessageQuotaWeek.updateOne(
            { guildId: interaction.guildId, weekKey: week.weekKey, 'failedMembers.userId': interaction.user.id },
            {
                $set: {
                    'failedMembers.$[member].appealStatus': 'Pending',
                    'failedMembers.$[member].appealId': appealId,
                    updatedAt: new Date(),
                },
            },
            { arrayFilters: [{ 'member.userId': interaction.user.id, 'member.appealStatus': 'Active' }] },
        ).exec().catch(() => null);

        if (!marked?.modifiedCount) {
            await QuotaAppeal.deleteOne({ appealId }).exec().catch(() => undefined);
            await interaction.editReply('Your quota appeal state changed while the form was open.');
            return true;
        }

        const reviewChannel = await interaction.client.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
        if (!reviewChannel?.isSendable()) {
            await QuotaAppeal.deleteOne({ appealId }).exec().catch(() => undefined);
            await MessageQuotaWeek.updateOne(
                { guildId: interaction.guildId, weekKey: week.weekKey, 'failedMembers.appealId': appealId },
                {
                    $set: { 'failedMembers.$[member].appealStatus': 'Active', updatedAt: new Date() },
                    $unset: { 'failedMembers.$[member].appealId': 1 },
                },
                { arrayFilters: [{ 'member.appealId': appealId }] },
            ).exec().catch(() => undefined);
            await interaction.editReply('The quota appeal review channel is unavailable. Please try again later.');
            return true;
        }

        const reviewMessage = await reviewChannel.send({
            components: [buildQuotaAppealReviewPanel(appeal)],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        appeal.reviewChannelId = reviewChannel.id;
        appeal.reviewMessageId = reviewMessage.id;

        await QuotaAppeal.updateOne(
            { appealId },
            { $set: { reviewChannelId: reviewChannel.id, reviewMessageId: reviewMessage.id, updatedAt: new Date() } },
        ).exec().catch(() => undefined);

        const refreshed = await MessageQuotaWeek.findOne({ guildId: interaction.guildId, weekKey: week.weekKey }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        if (refreshed) await refreshWeeklyInfractionPanel(interaction.client, refreshed);

        await sendQuotaLog(
            interaction.client,
            '⚖️ Quota Appeal Submitted',
            `**Member:** <@${interaction.user.id}>\n**Week:** \`${week.weekKey}\`\n**Appeal ID:** \`${appealId}\`\n**Status:** Pending`,
        );
        await interaction.editReply(`✅ Your quota appeal was submitted. Appeal ID: ${appealId}`);
        return true;
    }

    const decision = interaction.customId.match(/^quota:appeal-decision:(approve|deny):(QA-[A-Z0-9-]+)$/u);
    if (decision) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await canReviewQuotaAppeal(interaction) || !isDatabaseAvailable()) {
            await interaction.editReply(`You need <@&${INFRACTION_AUTHORIZED_ROLE_ID}> to review quota appeals.`);
            return true;
        }

        const status = decision[1] === 'approve' ? 'Approved' : 'Denied';
        const reviewReason = interaction.fields.getTextInputValue('reason').trim();
        const updated = await QuotaAppeal.findOneAndUpdate(
            { appealId: decision[2], status: 'Pending' },
            {
                $set: {
                    status,
                    reviewedById: interaction.user.id,
                    reviewReason,
                    updatedAt: new Date(),
                },
            },
            { new: true },
        ).lean().exec().catch(() => null) as unknown as QuotaAppealRecord | null;

        if (!updated) {
            await interaction.editReply('This quota appeal was already reviewed or could not be found.');
            return true;
        }

        await MessageQuotaWeek.updateOne(
            { guildId: updated.guildId, weekKey: updated.weekKey, 'failedMembers.appealId': updated.appealId },
            { $set: { 'failedMembers.$[member].appealStatus': status, updatedAt: new Date() } },
            { arrayFilters: [{ 'member.appealId': updated.appealId }] },
        ).exec().catch(() => undefined);

        const reviewChannel = updated.reviewChannelId
            ? await interaction.client.channels.fetch(updated.reviewChannelId).catch(() => null)
            : null;
        if (reviewChannel?.isTextBased() && 'messages' in reviewChannel && updated.reviewMessageId) {
            const reviewMessage = await reviewChannel.messages.fetch(updated.reviewMessageId).catch(() => null);
            if (reviewMessage) {
                await reviewMessage.edit({
                    components: [buildQuotaAppealReviewPanel(updated)],
                    attachments: Array.from(reviewMessage.attachments.values()),
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                }).catch(() => undefined);
            }
        }

        const week = await MessageQuotaWeek.findOne({ guildId: updated.guildId, weekKey: updated.weekKey }).lean().exec()
            .catch(() => null) as unknown as MessageQuotaWeekRecord | null;
        if (week) await refreshWeeklyInfractionPanel(interaction.client, week);

        const user = await interaction.client.users.fetch(updated.userId).catch(() => null);
        if (user) {
            await user.send({
                components: [buildSimpleQuotaPanel(
                    status === 'Approved' ? '✅ Quota Appeal Approved' : '❌ Quota Appeal Denied',
                    [
                        `**Appeal ID:** \`${updated.appealId}\``,
                        `**Week:** \`${updated.weekKey}\``,
                        `**Decision:** ${status}`,
                        `**Review Reason:** ${safeText(reviewReason, 1_000)}`,
                    ].join('\n'),
                    status === 'Approved' ? 0x22c55e : 0xef4444,
                )],
                files: [underbannerAttachment()],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            }).catch(() => undefined);
        }

        await sendQuotaLog(
            interaction.client,
            status === 'Approved' ? '✅ Quota Appeal Approved' : '❌ Quota Appeal Denied',
            [
                `**Member:** <@${updated.userId}>`,
                `**Week:** \`${updated.weekKey}\``,
                `**Appeal ID:** \`${updated.appealId}\``,
                `**Reviewed By:** <@${interaction.user.id}>`,
                `**Reason:** ${safeText(reviewReason, 800)}`,
            ].join('\n'),
            status === 'Approved' ? 0x22c55e : 0xef4444,
        );
        await interaction.editReply(`✅ ${updated.appealId} was ${status.toLowerCase()}.`);
        return true;
    }

    return false;
}

async function schedulerTick(client: Client): Promise<void> {
    if (!client.isReady() || !isDatabaseAvailable()) return;
    for (const guildId of client.guilds.cache.keys()) {
        try {
            await ensureActiveWeek(client, guildId, new Date());
        } catch (error) {
            logger.warn(`[Quota] Scheduler tick failed for ${guildId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export function startMessageQuotaScheduler(client: Client): void {
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
    if (!process.env.QUOTA_MOD_ROLE_ID) {
        logger.warn(`[Quota] The supplied Moderator role ID matched the quota log channel. Using fallback Moderator role ${MOD_ROLE_ID}. Set QUOTA_MOD_ROLE_ID to override it.`);
    }
    void schedulerTick(client);
    schedulerTimer = setInterval(() => void schedulerTick(client), SCHEDULER_INTERVAL_MS);
    logger.info(`[Quota] Every-team valid-message quota scheduler active. Standard deadline: Friday 9:00 AM ${EASTERN_TIME_ZONE}.`);
}

export function stopMessageQuotaScheduler(): void {
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
}
