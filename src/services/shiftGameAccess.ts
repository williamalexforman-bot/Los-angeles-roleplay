import { ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { SHIFT_QUOTA_BY_ROLE_ID } from '../commands/shift';
import { fetchErlcServer, type ErlcPlayer } from './erlcService';
import { resolveDockRobloxProfile, type DockRobloxProfile } from './dockService';
import { logger } from '../utils/logger';

const ERLC_COMMAND_ENDPOINT = 'https://api.erlc.gg/v1/server/command';
const MODERATOR_ROLE_ID = '1521593407795888336';
const SHIFT_ROLE_IDS = new Set(Object.keys(SHIFT_QUOTA_BY_ROLE_ID));
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

function roleIds(member: ChatInputCommandInteraction['member'] | GuildMember | null): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    if (Array.isArray(member.roles)) return member.roles;
    return [];
}

async function currentRoleIds(interaction: ChatInputCommandInteraction): Promise<string[]> {
    const fromInteraction = roleIds(interaction.member);
    if (!interaction.guild) return fromInteraction;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Array.from(new Set([...fromInteraction, ...roleIds(fetched)]));
}

function requestedPermission(memberRoleIds: readonly string[]): InGameShiftPermission | null {
    if (memberRoleIds.includes(MODERATOR_ROLE_ID)) return 'mod';
    if (memberRoleIds.some(id => SHIFT_ROLE_IDS.has(id))) return 'admin';
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
    const permission = requestedPermission(memberRoleIds);
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
