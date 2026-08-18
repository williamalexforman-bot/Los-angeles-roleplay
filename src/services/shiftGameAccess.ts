import { ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { fetchErlcServer, type ErlcPlayer } from './erlcService';
import { resolveDockRobloxProfile, type DockRobloxProfile } from './dockService';
import { runErlcCommand } from './erlcCommandService';
import { logger } from '../utils/logger';

const ERLC_COMMAND_ENDPOINT = 'https://api.erlc.gg/v1/server/command';
const MOD_SHIFT_ROLE_IDS = new Set([
    '1521593407795888336', // Moderation Team
    '1521593407804280967', // Administration Team
    '1521593407816990811', // Internal Affairs Team
    '1521593407816990819', // Supervisor Team
]);
const ADMIN_SHIFT_ROLE_IDS = new Set([
    '1521593407741362259', // Management Team
    '1521593407833640981', // Assistant Head Of Staff
    '1523164030448173206', // Head Of Staff
    '1534538735037972510', // Community Manager
    '1523111129696702584', // Board Of Executives
    '1521593407833640986', // Board of Directors
    '1521598108226818288', // Ownership Team
    '1521593407850680401', // Owner
]);
const CHECK_TIMEOUT_MS = 1_800;
const COMMAND_TIMEOUT_MS = 4_000;

export type InGameShiftPermission = 'mod' | 'admin';

export interface ShiftGameAccessSuccess {
    ok: true;
    permission: InGameShiftPermission;
    roblox: DockRobloxProfile;
    player: ErlcPlayer;
}

export interface ShiftGameAccessFailure {
    ok: false;
    message: string;
}

export type ShiftGameAccessResult = ShiftGameAccessSuccess | ShiftGameAccessFailure;

export interface ShiftGamePermissionDependencies {
    resolveDock?: typeof resolveDockRobloxProfile;
    fetchServer?: typeof fetchErlcServer;
    runCommand?: typeof runErlcCommand;
}

function roleIds(member: ChatInputCommandInteraction['member'] | GuildMember | null): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    if (Array.isArray(member.roles)) return member.roles;
    const cache = (member.roles as { cache?: { keys(): IterableIterator<string> } }).cache;
    if (cache?.keys) return [...cache.keys()];
    return [];
}

async function currentRoleIds(interaction: ChatInputCommandInteraction): Promise<string[]> {
    const fromInteraction = roleIds(interaction.member);
    if (!interaction.guild) return fromInteraction;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Array.from(new Set([...fromInteraction, ...roleIds(fetched)]));
}

export function shiftGamePermissionForRoleIds(memberRoleIds: readonly string[]): InGameShiftPermission | null {
    // Management and higher can retain lower staff roles after promotion, so
    // admin must win when roles from both sides of the cutoff are present.
    if (memberRoleIds.some(id => ADMIN_SHIFT_ROLE_IDS.has(id))) return 'admin';
    if (memberRoleIds.some(id => MOD_SHIFT_ROLE_IDS.has(id))) return 'mod';
    return null;
}

/**
 * Checks Dock verification and the live ER:LC player list before /shift start.
 * Both remote calls run concurrently so the Discord interaction is still
 * acknowledged by the existing shift command within Discord's response window.
 */
export async function verifyShiftGameAccess(
    interaction: ChatInputCommandInteraction,
): Promise<ShiftGameAccessResult> {
    if (!interaction.guildId) return { ok: false, message: 'This command can only be used in the server.' };

    const memberRoleIds = await currentRoleIds(interaction);
    const permission = shiftGamePermissionForRoleIds(memberRoleIds);
    if (!permission) {
        return { ok: false, message: 'You do not have a staff role that is configured for shift access.' };
    }

    const [dock, erlc] = await Promise.all([
        resolveDockRobloxProfile(interaction.guildId, interaction.user.id, { timeoutMs: CHECK_TIMEOUT_MS }),
        fetchErlcServer({ timeoutMs: CHECK_TIMEOUT_MS }),
    ]);

    if (!dock.ok) {
        const message = dock.status === 'not_verified'
            ? '❌ You must verify your Roblox account with Dock before starting a shift.'
            : dock.status === 'not_configured'
                ? '❌ Dock verification is not configured on the bot yet.'
                : '❌ I could not verify your Roblox account with Dock right now. Please try again shortly.';
        return { ok: false, message };
    }

    if (!erlc.ok) {
        logger.warn(`[Shift] ER:LC live-player check failed with status ${erlc.status}.`);
        return {
            ok: false,
            message: '❌ I could not verify that you are in the ER:LC server right now, so your shift was not started.',
        };
    }

    const player = erlc.data.players.find(candidate => candidate.player.robloxId === dock.profile.robloxId);
    if (!player) {
        return {
            ok: false,
            message: `❌ Your Dock-verified Roblox account (${dock.profile.username || dock.profile.robloxId}) is not currently inside the ER:LC server. Join the server before starting your shift.`,
        };
    }

    return { ok: true, permission, roblox: dock.profile, player };
}

function alreadyHasPermission(player: ErlcPlayer, target: InGameShiftPermission): boolean {
    const current = player.permission.toLowerCase();
    if (current.includes('owner') || current.includes('administrator')) return true;
    return target === 'mod' && current.includes('moderator');
}

/** Grants :mod or :admin through the ER:LC virtual server management endpoint. */
export async function grantShiftGamePermission(
    interaction: ChatInputCommandInteraction,
    access: ShiftGameAccessSuccess,
): Promise<void> {
    if (alreadyHasPermission(access.player, access.permission)) {
        await interaction.followUp({
            content: `🎮 Your Roblox account **${access.player.player.name}** is in-game and already has the required ${access.permission === 'mod' ? 'Moderator' : 'Administrator'} permission.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
        return;
    }

    const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
    if (!serverKey) {
        await interaction.followUp({
            content: '⚠️ Your shift started, but the ER:LC server key is not configured so I could not grant in-game permissions.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
    try {
        const command = access.permission === 'mod'
            ? `:mod ${access.player.player.name}`
            : `:admin ${access.player.player.name}`;
        const response = await fetch(ERLC_COMMAND_ENDPOINT, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'server-key': serverKey,
            },
            body: JSON.stringify({ command }),
            signal: controller.signal,
        });
        if (!response.ok) {
            logger.warn(`[Shift] ER:LC permission command returned HTTP ${response.status} for ${interaction.user.id}.`);
            await interaction.followUp({
                content: `⚠️ Your shift started and you were verified in-game, but I could not grant ${access.permission === 'mod' ? 'Moderator' : 'Administrator'} permissions automatically.`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => undefined);
            return;
        }

        await interaction.followUp({
            content: `🎮 Verified as **${access.player.player.name}** and granted ER:LC **${access.permission === 'mod' ? 'Moderator' : 'Administrator'}** permissions.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    } catch {
        logger.warn(`[Shift] ER:LC permission command could not be completed for ${interaction.user.id}.`);
        await interaction.followUp({
            content: '⚠️ Your shift started and your Roblox account was verified in-game, but the automatic permission command could not be completed.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
    } finally {
        clearTimeout(timer);
    }
}

/** Removes the shift-granted ER:LC permission after a successful /shift end. */
export async function revokeShiftGamePermission(
    interaction: ChatInputCommandInteraction,
    dependencies: ShiftGamePermissionDependencies = {},
): Promise<void> {
    if (!interaction.guildId) return;

    const memberRoleIds = await currentRoleIds(interaction);
    const rankedPermission = shiftGamePermissionForRoleIds(memberRoleIds);
    if (!rankedPermission) return;

    const resolveDock = dependencies.resolveDock || resolveDockRobloxProfile;
    const fetchServer = dependencies.fetchServer || fetchErlcServer;
    const runCommand = dependencies.runCommand || runErlcCommand;

    const [dock, erlc] = await Promise.all([
        resolveDock(interaction.guildId, interaction.user.id, { timeoutMs: CHECK_TIMEOUT_MS }),
        fetchServer({ timeoutMs: CHECK_TIMEOUT_MS }),
    ]);
    if (!dock.ok) {
        logger.warn(`[Shift] Could not resolve Dock account while removing ER:LC permission for ${interaction.user.id}: ${dock.status}.`);
        await interaction.followUp({
            content: '⚠️ Your shift ended, but I could not resolve your Dock account to remove your in-game permission automatically.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return;
    }

    const player = erlc.ok
        ? erlc.data.players.find(candidate => candidate.player.robloxId === dock.profile.robloxId)
        : null;
    const playerName = player?.player.name || dock.profile.username;
    if (!playerName) {
        await interaction.followUp({
            content: '⚠️ Your shift ended, but your Roblox username was unavailable, so I could not remove your in-game permission automatically.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return;
    }

    const currentPermission = player?.permission.toLowerCase() || '';
    if (currentPermission.includes('owner')) {
        await interaction.followUp({
            content: '🎮 Your shift ended. ER:LC owner permission was left unchanged.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return;
    }

    const permission: InGameShiftPermission = currentPermission.includes('admin')
        ? 'admin'
        : currentPermission.includes('mod')
            ? 'mod'
            : rankedPermission;
    const command = permission === 'admin' ? `:unadmin ${playerName}` : `:unmod ${playerName}`;
    const result = await runCommand(command);
    if (!result.ok) {
        logger.warn(`[Shift] Could not remove ER:LC ${permission} permission from ${interaction.user.id}: ${result.message}`);
        await interaction.followUp({
            content: `⚠️ Your shift ended, but I could not remove your ER:LC **${permission === 'admin' ? 'Administrator' : 'Moderator'}** permission automatically.`,
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return;
    }

    await interaction.followUp({
        content: `🎮 Removed ER:LC **${permission === 'admin' ? 'Administrator' : 'Moderator'}** permission from **${playerName}** because your shift ended.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}
