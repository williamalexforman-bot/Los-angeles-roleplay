import {
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
    SlashCommandBuilder,
    TextDisplayBuilder,
    type User,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { ShiftProfile as ShiftProfileModel, ShiftQuotaEvaluation } from '../database/models';
import { issueAutomaticInfraction } from './staffManagement';
import { logger } from '../utils/logger';

const EASTERN_TIME_ZONE = 'America/New_York';
const SCHEDULER_INTERVAL_MS = 60_000;
const EVALUATION_LEASE_MS = 15 * 60_000;
const ACTIVATION_KEY = '__activation__';
export const ACTIVE_SHIFT_ROLE_ID = '1521593407825248360';
export const SHIFT_BREAK_ROLE_ID = '1521593407825248358';
export const SHIFT_MANAGEMENT_ROLE_ID = '1521593407850680401';

export const SHIFT_INFRACTION_EXEMPT_ROLE_IDS = Object.freeze([
    '1521593407850680401',
    '1521593407795888329',
] as const);

/** Weekly requirements in seconds, keyed by the exact role IDs supplied by management. */
export const SHIFT_QUOTA_BY_ROLE_ID: Readonly<Record<string, number>> = Object.freeze({
    '1521593407795888336': 2 * 60 * 60,
    '1521593407804280967': 2 * 60 * 60,
    '1521593407816990811': 2 * 60 * 60,
    '1521593407816990819': 90 * 60,
    '1521593407741362259': 90 * 60,
    '1521593407833640981': 75 * 60,
    '1523164030448173206': 75 * 60,
    '1534538735037972510': 75 * 60,
    '1523111129696702584': 60 * 60,
    '1521593407833640986': 45 * 60,
    '1521598108226818288': 30 * 60,
});

interface ShiftProfile {
    guildId: string;
    userId: string;
    username: string;
    activeStartedAt: Date | null;
    breakStartedAt: Date | null;
    quotaSeconds: number | null;
    infractionExempt: boolean;
    weeklySeconds: Record<string, number>;
    completionDmWeeks: string[];
    quotaInfractionWeeks: string[];
    updatedAt: Date;
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
const memoryProfiles = new Map<string, ShiftProfile>();
const profileLocks = new Map<string, Promise<void>>();
const memoryQuotaActivation = new Map<string, Date>();
const memoryQuotaEvaluations = new Set<string>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function profileKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

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

function localDateShift(year: number, month: number, day: number, days: number): Pick<EasternParts, 'year' | 'month' | 'day'> {
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

/** Converts an Eastern wall-clock time to its UTC instant, including DST. */
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

/** Returns the Friday 10:00 AM Eastern boundary that starts the current quota week. */
export function shiftQuotaBoundary(at: Date = new Date()): Date {
    const local = easternParts(at);
    const localWeekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const daysSinceFriday = (localWeekday - 5 + 7) % 7;
    let friday = localDateShift(local.year, local.month, local.day, -daysSinceFriday);
    let boundary = easternWallClockToUtc({ ...friday, hour: 10, minute: 0, second: 0 });
    if (at.getTime() < boundary.getTime()) {
        friday = localDateShift(friday.year, friday.month, friday.day, -7);
        boundary = easternWallClockToUtc({ ...friday, hour: 10, minute: 0, second: 0 });
    }
    return boundary;
}

function weekKeyFromBoundary(boundary: Date): string {
    const local = easternParts(boundary);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

export function shiftQuotaWeekKey(at: Date = new Date()): string {
    return weekKeyFromBoundary(shiftQuotaBoundary(at));
}

function nextShiftQuotaBoundary(at: Date): Date {
    const current = easternParts(shiftQuotaBoundary(at));
    const next = localDateShift(current.year, current.month, current.day, 7);
    return easternWallClockToUtc({ ...next, hour: 10, minute: 0, second: 0 });
}

export function shiftQuotaSecondsForRoleIds(roleIds: Iterable<string>): number | null {
    let quota: number | null = null;
    for (const roleId of roleIds) {
        const roleQuota = SHIFT_QUOTA_BY_ROLE_ID[roleId];
        if (roleQuota !== undefined) quota = Math.max(quota || 0, roleQuota);
    }
    return quota;
}

export function isShiftInfractionExempt(roleIds: Iterable<string>): boolean {
    const exemptions = new Set<string>(SHIFT_INFRACTION_EXEMPT_ROLE_IDS);
    for (const roleId of roleIds) {
        if (exemptions.has(roleId)) return true;
    }
    return false;
}

function sanitizeWeeklySeconds(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key, seconds]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Number(seconds)))
            .map(([key, seconds]) => [key, Math.max(0, Number(seconds))]),
    );
}

function profileFromRecord(record: Record<string, unknown>): ShiftProfile {
    return {
        guildId: String(record.guildId),
        userId: String(record.userId),
        username: String(record.username),
        activeStartedAt: record.activeStartedAt ? new Date(String(record.activeStartedAt)) : null,
        breakStartedAt: record.breakStartedAt ? new Date(String(record.breakStartedAt)) : null,
        quotaSeconds: Number.isFinite(Number(record.quotaSeconds)) ? Number(record.quotaSeconds) : null,
        infractionExempt: Boolean(record.infractionExempt),
        weeklySeconds: sanitizeWeeklySeconds(record.weeklySeconds),
        completionDmWeeks: Array.isArray(record.completionDmWeeks) ? record.completionDmWeeks.map(String) : [],
        quotaInfractionWeeks: Array.isArray(record.quotaInfractionWeeks) ? record.quotaInfractionWeeks.map(String) : [],
        updatedAt: record.updatedAt ? new Date(String(record.updatedAt)) : new Date(),
    };
}

function newProfile(guildId: string, userId: string, username: string): ShiftProfile {
    return {
        guildId,
        userId,
        username,
        activeStartedAt: null,
        breakStartedAt: null,
        quotaSeconds: null,
        infractionExempt: false,
        weeklySeconds: {},
        completionDmWeeks: [],
        quotaInfractionWeeks: [],
        updatedAt: new Date(),
    };
}

async function loadProfile(guildId: string, userId: string, username: string): Promise<ShiftProfile> {
    const key = profileKey(guildId, userId);
    const cached = memoryProfiles.get(key);
    if (cached) {
        cached.username = username;
        return cached;
    }

    if (isDatabaseAvailable()) {
        try {
            const stored = await ShiftProfileModel.findOne({ guildId, userId }).lean().exec();
            if (stored) {
                const profile = profileFromRecord(stored as unknown as Record<string, unknown>);
                profile.username = username;
                memoryProfiles.set(key, profile);
                return profile;
            }
        } catch (error) {
            logger.warn(`[Shift] Could not load ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    const profile = newProfile(guildId, userId, username);
    memoryProfiles.set(key, profile);
    return profile;
}

function trimProfileHistory(profile: ShiftProfile): void {
    const recentKeys = Object.keys(profile.weeklySeconds).sort().slice(-16);
    profile.weeklySeconds = Object.fromEntries(recentKeys.map(key => [key, profile.weeklySeconds[key]]));
    profile.completionDmWeeks = Array.from(new Set(profile.completionDmWeeks)).sort().slice(-52);
    profile.quotaInfractionWeeks = Array.from(new Set(profile.quotaInfractionWeeks)).sort().slice(-52);
}

async function saveProfile(profile: ShiftProfile): Promise<void> {
    profile.updatedAt = new Date();
    trimProfileHistory(profile);
    memoryProfiles.set(profileKey(profile.guildId, profile.userId), profile);
    if (!isDatabaseAvailable()) return;

    const update: Record<string, unknown> = {
        $set: {
            guildId: profile.guildId,
            userId: profile.userId,
            username: profile.username,
            quotaSeconds: profile.quotaSeconds,
            infractionExempt: profile.infractionExempt,
            weeklySeconds: profile.weeklySeconds,
            completionDmWeeks: profile.completionDmWeeks,
            quotaInfractionWeeks: profile.quotaInfractionWeeks,
            updatedAt: profile.updatedAt,
        },
    };
    if (profile.activeStartedAt) {
        (update.$set as Record<string, unknown>).activeStartedAt = profile.activeStartedAt;
    } else {
        update.$unset = { activeStartedAt: 1 };
    }
    if (profile.breakStartedAt) {
        (update.$set as Record<string, unknown>).breakStartedAt = profile.breakStartedAt;
    } else {
        update.$unset = { ...(update.$unset as Record<string, unknown> | undefined), breakStartedAt: 1 };
    }
    try {
        await ShiftProfileModel.findOneAndUpdate(
            { guildId: profile.guildId, userId: profile.userId },
            update,
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec();
    } catch (error) {
        // Shift commands must continue using the in-memory copy if MongoDB is
        // connected but temporarily rejects or times out on a write.
        logger.warn(`[Shift] Could not persist ${profile.userId}; continuing with in-memory tracking: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function listProfiles(guildId: string): Promise<ShiftProfile[]> {
    const combined = new Map<string, ShiftProfile>();
    if (isDatabaseAvailable()) {
        try {
            const stored = await ShiftProfileModel.find({ guildId }).lean().exec();
            for (const record of stored) {
                const profile = profileFromRecord(record as unknown as Record<string, unknown>);
                combined.set(profile.userId, profile);
            }
        } catch (error) {
            logger.warn(`[Shift] Could not load leaderboard profiles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    for (const profile of memoryProfiles.values()) {
        if (profile.guildId === guildId) combined.set(profile.userId, profile);
    }
    return [...combined.values()];
}

async function withProfileLock<T>(guildId: string, userId: string, operation: () => Promise<T>): Promise<T> {
    const key = profileKey(guildId, userId);
    const previous = profileLocks.get(key) || Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    profileLocks.set(key, tail);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (profileLocks.get(key) === tail) profileLocks.delete(key);
    }
}

function creditElapsed(profile: ShiftProfile, startedAt: Date, endedAt: Date): number {
    if (endedAt.getTime() <= startedAt.getTime()) return 0;
    let cursor = new Date(startedAt);
    let credited = 0;
    while (cursor.getTime() < endedAt.getTime()) {
        const weekKey = shiftQuotaWeekKey(cursor);
        const nextBoundary = nextShiftQuotaBoundary(cursor);
        const segmentEnd = new Date(Math.min(endedAt.getTime(), nextBoundary.getTime()));
        const seconds = Math.max(0, (segmentEnd.getTime() - cursor.getTime()) / 1000);
        profile.weeklySeconds[weekKey] = (profile.weeklySeconds[weekKey] || 0) + seconds;
        credited += seconds;
        cursor = segmentEnd;
    }
    return credited;
}

function totalAt(profile: ShiftProfile, weekKey: string, at: Date): number {
    let total = profile.weeklySeconds[weekKey] || 0;
    if (profile.activeStartedAt) {
        const activeCopy = { ...profile, weeklySeconds: { ...profile.weeklySeconds } };
        creditElapsed(activeCopy, profile.activeStartedAt, at);
        total = activeCopy.weeklySeconds[weekKey] || 0;
    }
    return total;
}

function formatDuration(seconds: number): string {
    const totalMinutes = Math.max(0, Math.floor(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes}m`;
    if (!minutes) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function memberRoleIds(member: GuildMember | ChatInputCommandInteraction['member']): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    if (Array.isArray(member.roles)) return member.roles;
    const roles = member.roles as unknown as { cache?: Map<string, unknown> };
    return roles.cache ? [...roles.cache.keys()] : [];
}

function refreshProfileQuotaSnapshot(
    profile: ShiftProfile,
    member: GuildMember | ChatInputCommandInteraction['member'],
): void {
    const roleIds = memberRoleIds(member);
    profile.quotaSeconds = shiftQuotaSecondsForRoleIds(roleIds);
    profile.infractionExempt = isShiftInfractionExempt(roleIds);
}

type ShiftRoleState = 'active' | 'break' | 'ended';

async function setMemberShiftRoleState(member: GuildMember, state: ShiftRoleState, actorId: string): Promise<boolean> {
    const reason = `Shift state changed to ${state} by ${actorId}`;
    let successful = true;
    const removeRole = async (roleId: string): Promise<void> => {
        if (!member.roles.cache.has(roleId)) return;
        await member.roles.remove(roleId, reason).catch(error => {
            successful = false;
            logger.warn(`[Shift] Could not remove state role ${roleId} from ${member.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    };
    const addRole = async (roleId: string): Promise<void> => {
        if (member.roles.cache.has(roleId)) return;
        await member.roles.add(roleId, reason).catch(error => {
            successful = false;
            logger.warn(`[Shift] Could not add state role ${roleId} to ${member.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    };

    if (state === 'active') {
        await removeRole(SHIFT_BREAK_ROLE_ID);
        await addRole(ACTIVE_SHIFT_ROLE_ID);
    } else if (state === 'break') {
        await removeRole(ACTIVE_SHIFT_ROLE_ID);
        await addRole(SHIFT_BREAK_ROLE_ID);
    } else {
        await removeRole(ACTIVE_SHIFT_ROLE_ID);
        await removeRole(SHIFT_BREAK_ROLE_ID);
    }
    return successful;
}

function quotaCompletionPanel(total: number, quota: number, weekKey: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                '## ✅ Weekly Shift Quota Completed',
                `You completed your required weekly shift quota for the week beginning **${weekKey}**.`,
                '',
                `**Completed:** ${formatDuration(total)}`,
                `**Required:** ${formatDuration(quota)}`,
                '',
                'Thank you for completing your staff activity requirement.',
            ].join('\n')),
        );
}

async function notifyQuotaComplete(
    user: User,
    profile: ShiftProfile,
    weekKey: string,
    quota: number,
    total: number,
): Promise<boolean> {
    if (total < quota || profile.completionDmWeeks.includes(weekKey)) return false;
    const delivered = await user.send({
        components: [quotaCompletionPanel(total, quota, weekKey)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).then(() => true).catch(() => false);
    if (delivered) profile.completionDmWeeks.push(weekKey);
    return delivered;
}

async function canManageShifts(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (memberRoleIds(interaction.member).includes(SHIFT_MANAGEMENT_ROLE_ID)) return true;
    if (!interaction.guild) return false;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched && memberRoleIds(fetched).includes(SHIFT_MANAGEMENT_ROLE_ID));
}

async function currentGuildMember(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
    if (interaction.member instanceof GuildMember) return interaction.member;
    if (!interaction.guild) return null;
    return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function executeShiftStart(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const now = new Date();
    await withProfileLock(interaction.guildId, interaction.user.id, async () => {
        const profile = await loadProfile(interaction.guildId!, interaction.user.id, interaction.user.username);
        if (profile.activeStartedAt || profile.breakStartedAt) {
            const stateStartedAt = profile.activeStartedAt || profile.breakStartedAt!;
            const member = await currentGuildMember(interaction);
            const rolesUpdated = member
                ? await setMemberShiftRoleState(member, profile.breakStartedAt ? 'break' : 'active', interaction.user.id)
                : false;
            await interaction.editReply(
                `You already have a ${profile.breakStartedAt ? 'paused shift' : 'shift'} started <t:${Math.floor(stateStartedAt.getTime() / 1000)}:R>.`
                + `${rolesUpdated ? ' Your shift-state role is synchronized.' : ' Warning: I could not synchronize your shift-state role.'}`,
            );
            return;
        }
        profile.activeStartedAt = now;
        profile.breakStartedAt = null;
        const member = await currentGuildMember(interaction);
        refreshProfileQuotaSnapshot(profile, member || interaction.member);
        const rolesUpdated = member
            ? await setMemberShiftRoleState(member, 'active', interaction.user.id)
            : false;
        await saveProfile(profile);
        const quota = profile.quotaSeconds;
        await interaction.editReply([
            `✅ Your shift started at <t:${Math.floor(now.getTime() / 1000)}:F>.`,
            quota ? `Your weekly quota is **${formatDuration(quota)}**.` : 'You do not currently have a configured quota role.',
            'Use `/shift end` when you finish.',
            rolesUpdated ? `You received the <@&${ACTIVE_SHIFT_ROLE_ID}> role.` : 'Warning: I could not update your active-shift role. Staff time is still being tracked.',
        ].join('\n'));
    });
}

async function executeShiftBreak(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const now = new Date();
    await withProfileLock(interaction.guildId, interaction.user.id, async () => {
        const profile = await loadProfile(interaction.guildId!, interaction.user.id, interaction.user.username);
        const member = await currentGuildMember(interaction);
        refreshProfileQuotaSnapshot(profile, member || interaction.member);
        if (!profile.activeStartedAt && !profile.breakStartedAt) {
            await interaction.editReply('You do not have an active or paused shift. Use `/shift start` first.');
            return;
        }

        if (profile.activeStartedAt) {
            const credited = creditElapsed(profile, profile.activeStartedAt, now);
            profile.activeStartedAt = null;
            profile.breakStartedAt = now;
            const rolesUpdated = member
                ? await setMemberShiftRoleState(member, 'break', interaction.user.id)
                : false;
            const weekKey = shiftQuotaWeekKey(now);
            const total = profile.weeklySeconds[weekKey] || 0;
            const quota = profile.quotaSeconds;
            if (quota) await notifyQuotaComplete(interaction.user, profile, weekKey, quota, total);
            await saveProfile(profile);
            await interaction.editReply([
                `⏸️ Your shift is paused. **Active time credited:** ${formatDuration(credited)}.`,
                `**Weekly total:** ${formatDuration(total)}${quota ? ` / ${formatDuration(quota)}` : ''}`,
                'Run `/shift break` again when you are ready to resume. Break time does not count toward quota.',
                rolesUpdated ? `You received the <@&${SHIFT_BREAK_ROLE_ID}> role.` : 'Warning: I could not update your break role. Your timer is still paused.',
            ].join('\n'));
            return;
        }

        profile.breakStartedAt = null;
        profile.activeStartedAt = now;
        const rolesUpdated = member
            ? await setMemberShiftRoleState(member, 'active', interaction.user.id)
            : false;
        await saveProfile(profile);
        await interaction.editReply([
            '▶️ Your shift resumed. Only active time from this point forward will count.',
            rolesUpdated ? `You received the <@&${ACTIVE_SHIFT_ROLE_ID}> role.` : 'Warning: I could not restore your active-shift role. Staff time is still being tracked.',
        ].join('\n'));
    });
}

async function executeShiftEnd(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const now = new Date();
    await withProfileLock(interaction.guildId, interaction.user.id, async () => {
        const profile = await loadProfile(interaction.guildId!, interaction.user.id, interaction.user.username);
        if (!profile.activeStartedAt && !profile.breakStartedAt) {
            await interaction.editReply('You do not have an active shift. Use `/shift start` first.');
            return;
        }
        const credited = profile.activeStartedAt
            ? creditElapsed(profile, profile.activeStartedAt, now)
            : 0;
        const endedFromBreak = Boolean(profile.breakStartedAt);
        profile.activeStartedAt = null;
        profile.breakStartedAt = null;
        const weekKey = shiftQuotaWeekKey(now);
        const total = profile.weeklySeconds[weekKey] || 0;
        const member = await currentGuildMember(interaction);
        refreshProfileQuotaSnapshot(profile, member || interaction.member);
        const rolesUpdated = member
            ? await setMemberShiftRoleState(member, 'ended', interaction.user.id)
            : false;
        const quota = profile.quotaSeconds;
        if (quota) await notifyQuotaComplete(interaction.user, profile, weekKey, quota, total);
        await saveProfile(profile);
        const quotaCompleted = Boolean(quota && total >= quota);
        const completionDmDelivered = profile.completionDmWeeks.includes(weekKey);
        await interaction.editReply([
            `✅ Your shift ended${endedFromBreak ? ' from break' : ''}. **Final active segment:** ${formatDuration(credited)}.`,
            `**Weekly total:** ${formatDuration(total)}${quota ? ` / ${formatDuration(quota)}` : ''}`,
            quotaCompleted
                ? completionDmDelivered
                    ? '**Quota status:** ✅ Completed — a confirmation was sent to your DMs.'
                    : '**Quota status:** ✅ Completed — warning: your DM could not be delivered.'
                : '**Quota status:** In progress.',
            rolesUpdated ? 'Your active-shift and break roles were removed.' : 'Warning: I could not remove one or more shift-state roles.',
        ].join('\n'));
    });
}

async function executeShiftLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const now = new Date();
    const weekKey = shiftQuotaWeekKey(now);
    const profiles = new Map((await listProfiles(interaction.guildId)).map(profile => [profile.userId, profile]));
    const fetchedMembers = await interaction.guild.members.fetch().catch(() => interaction.guild!.members.cache);
    const rows: Array<{
        userId: string;
        displayName: string;
        total: number;
        quota: number;
        active: boolean;
        paused: boolean;
        exempt: boolean;
    }> = [];
    const visibleMemberIds = new Set<string>();
    for (const member of fetchedMembers.values()) {
        if (member.user.bot) continue;
        const quota = shiftQuotaSecondsForRoleIds(memberRoleIds(member));
        if (!quota) continue;
        const profile = profiles.get(member.id) || newProfile(interaction.guildId, member.id, member.user.username);
        refreshProfileQuotaSnapshot(profile, member);
        visibleMemberIds.add(member.id);
        rows.push({
            userId: member.id,
            displayName: member.displayName,
            quota,
            total: totalAt(profile, weekKey, now),
            active: Boolean(profile.activeStartedAt),
            paused: Boolean(profile.breakStartedAt),
            exempt: isShiftInfractionExempt(memberRoleIds(member)),
        });
    }
    // Without the privileged Server Members intent, Discord may only return a
    // partial member cache. Durable profile snapshots keep the leaderboard
    // useful for everyone who has used a shift command.
    for (const profile of profiles.values()) {
        if (visibleMemberIds.has(profile.userId) || !profile.quotaSeconds) continue;
        rows.push({
            userId: profile.userId,
            displayName: profile.username,
            quota: profile.quotaSeconds,
            total: totalAt(profile, weekKey, now),
            active: Boolean(profile.activeStartedAt),
            paused: Boolean(profile.breakStartedAt),
            exempt: profile.infractionExempt,
        });
    }
    rows.sort((left, right) => right.total - left.total || left.displayName.localeCompare(right.displayName));

    const description = rows.length
        ? rows.slice(0, 20).map((row, index) => {
            const status = row.total >= row.quota ? '✅' : row.paused ? '⏸️' : row.active ? '🟢' : '⏳';
            return `**${index + 1}.** <@${row.userId}> — **${formatDuration(row.total)}** / ${formatDuration(row.quota)} ${status}${row.exempt ? ' • 🛡️' : ''}`;
        }).join('\n')
        : 'No members with configured quota roles were found.';
    const nextBoundary = nextShiftQuotaBoundary(now);
    const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('⏱️ Weekly Shift Leaderboard')
        .setDescription(description)
        .addFields(
            { name: 'Quota Week', value: `Beginning ${weekKey}`, inline: true },
            { name: 'Resets', value: `<t:${Math.floor(nextBoundary.getTime() / 1000)}:F>`, inline: true },
            { name: 'Status Key', value: '✅ Complete • 🟢 On shift • ⏸️ On break • ⏳ In progress • 🛡️ Infraction exempt' },
        )
        .setFooter({ text: 'Los Angeles Roleplay | Shift Management' })
        .setTimestamp();
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function executeShiftManage(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    if (!(await canManageShifts(interaction))) {
        await interaction.editReply(`You need the <@&${SHIFT_MANAGEMENT_ROLE_ID}> role to use \`/shift manage\`.`);
        return;
    }

    const action = interaction.options.getString('action', true);
    const target = interaction.options.getUser('member', true);
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason', true);
    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
        await interaction.editReply('That member could not be loaded from this server.');
        return;
    }
    const now = new Date();
    const weekKey = shiftQuotaWeekKey(now);
    await withProfileLock(interaction.guildId, target.id, async () => {
        const profile = await loadProfile(interaction.guildId!, target.id, target.username);
        refreshProfileQuotaSnapshot(profile, targetMember);
        let actionSummary = '';
        if (action === 'add-time' || action === 'remove-time') {
            if (!minutes) {
                await interaction.editReply('The `minutes` option is required when adding or removing time.');
                return;
            }
            const delta = minutes * 60 * (action === 'add-time' ? 1 : -1);
            profile.weeklySeconds[weekKey] = Math.max(0, (profile.weeklySeconds[weekKey] || 0) + delta);
            actionSummary = `${action === 'add-time' ? 'Added' : 'Removed'} ${formatDuration(minutes * 60)} ${action === 'add-time' ? 'to' : 'from'} the current week.`;
        } else if (action === 'force-end') {
            if (!profile.activeStartedAt && !profile.breakStartedAt) {
                await interaction.editReply(`${target.username} does not have an active or paused shift.`);
                return;
            }
            const credited = profile.activeStartedAt
                ? creditElapsed(profile, profile.activeStartedAt, now)
                : 0;
            const endedFromBreak = Boolean(profile.breakStartedAt);
            profile.activeStartedAt = null;
            profile.breakStartedAt = null;
            const rolesUpdated = await setMemberShiftRoleState(targetMember, 'ended', interaction.user.id);
            actionSummary = `Force-ended the ${endedFromBreak ? 'paused' : 'active'} shift and credited ${formatDuration(credited)}.${rolesUpdated ? '' : ' Warning: one or more shift-state roles could not be removed.'}`;
        } else if (action === 'reset-week') {
            profile.weeklySeconds[weekKey] = 0;
            profile.completionDmWeeks = profile.completionDmWeeks.filter(key => key !== weekKey);
            actionSummary = 'Reset the current weekly total to 0m.';
        } else {
            await interaction.editReply('That shift-management action is unavailable.');
            return;
        }

        const quota = profile.quotaSeconds;
        const total = profile.weeklySeconds[weekKey] || 0;
        if (quota && (action === 'add-time' || action === 'force-end')) {
            await notifyQuotaComplete(target, profile, weekKey, quota, total);
        }
        await saveProfile(profile);
        logger.info(`[Shift] ${interaction.user.id} managed ${target.id}: ${action}; reason: ${reason}`);
        await interaction.editReply([
            `✅ ${actionSummary}`,
            `**Member:** ${target.username}`,
            `**Weekly total:** ${formatDuration(total)}${quota ? ` / ${formatDuration(quota)}` : ''}`,
            `**Reason:** ${reason}`,
        ].join('\n'));
    });
}

export const shiftCommand = {
    data: new SlashCommandBuilder()
        .setName('shift')
        .setDescription('Track staff shifts and weekly quota progress')
        .setDMPermission(false)
        .addSubcommand(subcommand => subcommand
            .setName('start')
            .setDescription('Start your staff shift'))
        .addSubcommand(subcommand => subcommand
            .setName('break')
            .setDescription('Pause or resume your active staff shift'))
        .addSubcommand(subcommand => subcommand
            .setName('leaderboard')
            .setDescription('View this week\'s shift leaderboard'))
        .addSubcommand(subcommand => subcommand
            .setName('manage')
            .setDescription('Manage a member\'s shift time')
            .addStringOption(option => option
                .setName('action')
                .setDescription('The management action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Add Time', value: 'add-time' },
                    { name: 'Remove Time', value: 'remove-time' },
                    { name: 'Force End', value: 'force-end' },
                    { name: 'Reset Current Week', value: 'reset-week' },
                ))
            .addUserOption(option => option
                .setName('member')
                .setDescription('The member whose shift should be managed')
                .setRequired(true))
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Why this shift record is being changed')
                .setRequired(true)
                .setMaxLength(500))
            .addIntegerOption(option => option
                .setName('minutes')
                .setDescription('Minutes to add or remove')
                .setMinValue(1)
                .setMaxValue(10_080)))
        .addSubcommand(subcommand => subcommand
            .setName('end')
            .setDescription('End your active staff shift')),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand(true);
        if (subcommand === 'leaderboard') await interaction.deferReply();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (subcommand === 'start') await executeShiftStart(interaction);
            else if (subcommand === 'break') await executeShiftBreak(interaction);
            else if (subcommand === 'end') await executeShiftEnd(interaction);
            else if (subcommand === 'leaderboard') await executeShiftLeaderboard(interaction);
            else if (subcommand === 'manage') await executeShiftManage(interaction);
            else await interaction.editReply('That shift command is unavailable.');
        } catch (error) {
            logger.error(`[Shift] Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await interaction.editReply('Unable to complete that shift command right now. Please try again.').catch(() => undefined);
        }
    },
};

async function ensureQuotaActivation(guildId: string, now: Date): Promise<Date> {
    const existing = await ShiftQuotaEvaluation.findOne({ guildId, weekKey: ACTIVATION_KEY }).lean().exec();
    if (existing) return new Date(existing.completedAt || existing.startedAt);
    try {
        const created = await ShiftQuotaEvaluation.create({
            guildId,
            weekKey: ACTIVATION_KEY,
            status: 'Completed',
            startedAt: now,
            completedAt: now,
        });
        return new Date(created.completedAt || created.startedAt);
    } catch {
        const raced = await ShiftQuotaEvaluation.findOne({ guildId, weekKey: ACTIVATION_KEY }).lean().exec();
        if (!raced) throw new Error('Could not initialize the shift quota scheduler.');
        return new Date(raced.completedAt || raced.startedAt);
    }
}

async function claimQuotaEvaluation(guildId: string, weekKey: string, now: Date): Promise<boolean> {
    const existing = await ShiftQuotaEvaluation.findOne({ guildId, weekKey }).lean().exec();
    if (existing?.status === 'Completed') return false;
    if (existing?.lockedUntil && new Date(existing.lockedUntil).getTime() > now.getTime()) return false;
    const lockedUntil = new Date(now.getTime() + EVALUATION_LEASE_MS);
    if (!existing) {
        try {
            await ShiftQuotaEvaluation.create({ guildId, weekKey, status: 'Processing', startedAt: now, lockedUntil });
            return true;
        } catch {
            return false;
        }
    }
    const updated = await ShiftQuotaEvaluation.updateOne(
        { guildId, weekKey, status: 'Processing', lockedUntil: existing.lockedUntil },
        { $set: { lockedUntil, startedAt: now } },
    ).exec();
    return updated.modifiedCount === 1;
}

async function finishQuotaEvaluation(guildId: string, weekKey: string, completedAt: Date): Promise<void> {
    await ShiftQuotaEvaluation.updateOne(
        { guildId, weekKey },
        { $set: { status: 'Completed', completedAt }, $unset: { lockedUntil: 1 } },
    ).exec();
}

export async function runDueShiftQuotaEvaluation(client: Client, now: Date = new Date()): Promise<void> {
    const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
    if (!guildId) return;
    const durable = isDatabaseAvailable();
    let activation = memoryQuotaActivation.get(guildId);
    if (durable) activation = await ensureQuotaActivation(guildId, now);
    else if (!activation) {
        activation = now;
        memoryQuotaActivation.set(guildId, activation);
    }
    const completedBoundary = shiftQuotaBoundary(now);
    const completedWeekInstant = new Date(completedBoundary.getTime() - 1);
    // Never run retroactively on first deployment. The first review is the
    // first Friday boundary that occurs after shift tracking is activated.
    if (completedBoundary.getTime() <= activation.getTime()) return;
    const completedWeekKey = shiftQuotaWeekKey(completedWeekInstant);
    const evaluationKey = profileKey(guildId, completedWeekKey);
    const claimed = durable
        ? await claimQuotaEvaluation(guildId, completedWeekKey, now)
        : !memoryQuotaEvaluations.has(evaluationKey);
    if (!claimed) return;
    if (!durable) memoryQuotaEvaluations.add(evaluationKey);

    try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        const members = await guild.members.fetch();
        const failures: string[] = [];
        for (const member of members.values()) {
            if (member.user.bot) continue;
            const quota = shiftQuotaSecondsForRoleIds(memberRoleIds(member));
            if (!quota) continue;
            const infractionExempt = isShiftInfractionExempt(memberRoleIds(member));
            try {
                await withProfileLock(guildId, member.id, async () => {
                    const profile = await loadProfile(guildId, member.id, member.user.username);
                    refreshProfileQuotaSnapshot(profile, member);
                    if (profile.activeStartedAt && profile.activeStartedAt.getTime() < completedBoundary.getTime()) {
                        creditElapsed(profile, profile.activeStartedAt, completedBoundary);
                        profile.activeStartedAt = completedBoundary;
                    }
                    const total = profile.weeklySeconds[completedWeekKey] || 0;
                    if (total >= quota) {
                        await notifyQuotaComplete(member.user, profile, completedWeekKey, quota, total);
                        await saveProfile(profile);
                        return;
                    }
                    if (infractionExempt) {
                        await saveProfile(profile);
                        logger.info(`[Shift Quota] ${member.id} missed ${completedWeekKey} but has an infraction-exempt role.`);
                        return;
                    }
                    if (profile.quotaInfractionWeeks.includes(completedWeekKey)) {
                        await saveProfile(profile);
                        return;
                    }

                    // Save the boundary split before the network-heavy case creation.
                    await saveProfile(profile);
                    const missing = Math.max(0, quota - total);
                    const issued = await issueAutomaticInfraction(client, guildId, member.user, {
                        reason: `Weekly shift quota was not completed. Required ${formatDuration(quota)}; completed ${formatDuration(total)}; missing ${formatDuration(missing)}.`,
                        ruleBroken: `Weekly Shift Quota — week beginning ${completedWeekKey}`,
                        evidence: `Automated shift record: ${formatDuration(total)} completed out of ${formatDuration(quota)} required.`,
                    });
                    profile.quotaInfractionWeeks.push(completedWeekKey);
                    await saveProfile(profile);
                    logger.info(`[Shift Quota] Issued ${issued.caseNumber} to ${member.id} for week ${completedWeekKey}.`);
                });
            } catch (error) {
                failures.push(member.id);
                logger.warn(`[Shift Quota] Could not evaluate ${member.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (failures.length) throw new Error(`Quota evaluation failed for ${failures.length} member(s).`);
        if (durable) await finishQuotaEvaluation(guildId, completedWeekKey, new Date());
        logger.info(`[Shift Quota] Completed the ${completedWeekKey} evaluation for ${members.size} guild members.`);
    } catch (error) {
        if (!durable) memoryQuotaEvaluations.delete(evaluationKey);
        logger.warn(`[Shift Quota] Evaluation for ${completedWeekKey} will retry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function startShiftQuotaScheduler(client: Client): void {
    stopShiftQuotaScheduler();
    void runDueShiftQuotaEvaluation(client).catch(error => {
        logger.warn(`[Shift Quota] Startup evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    schedulerTimer = setInterval(() => {
        void runDueShiftQuotaEvaluation(client).catch(error => {
            logger.warn(`[Shift Quota] Scheduled evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }, SCHEDULER_INTERVAL_MS);
    logger.info('Shift quota scheduler active for Fridays at 10:00 AM America/New_York.');
}

export function stopShiftQuotaScheduler(): void {
    if (!schedulerTimer) return;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
}

/** Test helper for isolating the in-memory fallback between command runs. */
export function clearShiftMemory(): void {
    memoryProfiles.clear();
    profileLocks.clear();
    memoryQuotaActivation.clear();
    memoryQuotaEvaluations.clear();
}
