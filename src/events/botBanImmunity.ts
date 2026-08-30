import {
    AuditLogEvent,
    Events,
    GuildBanManager,
    type Client,
    type Guild,
} from 'discord.js';
import { logger } from '../utils/logger';

const PATCH_KEY = Symbol.for('larp.permanentBotBanImmunity');
const BOT_BAN_SWEEP_INTERVAL_MS = 30_000;
let registered = false;

function installGuildBanCreateGuard(): void {
    const prototype = GuildBanManager?.prototype as (GuildBanManager & Record<PropertyKey, unknown>) | undefined;
    if (!prototype || prototype[PATCH_KEY]) return;

    Object.defineProperty(prototype, PATCH_KEY, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    GuildBanManager.prototype.create = async function protectedBanCreate(target) {
        const targetId = typeof target === 'string' ? target : target?.id || 'unknown';
        logger.warn(`[BotBanImmunity] BLOCKED guild.bans.create target=${targetId}. Discord bans are disabled by owner request.`);
        const error = new Error('Discord bans are disabled by the server owner; bot accounts must never be auto-banned.');
        (error as Error & { code?: string }).code = 'LARP_BOT_BAN_IMMUNITY';
        throw error;
    } as GuildBanManager['create'];

    logger.warn('[BotBanImmunity] guild.bans.create guard installed.');
}

async function latestBanExecutor(guild: Guild, targetId: string): Promise<string> {
    try {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 6 });
        const entry = logs.entries.find(item => item.targetId === targetId);
        if (!entry) return 'unknown';
        const executor = entry.executor;
        return executor ? `${executor.tag || executor.username}:${executor.id}` : `executorId=${entry.executorId || 'unknown'}`;
    } catch (error) {
        logger.warn(`[BotBanImmunity] Could not read ban audit log guild=${guild.id} target=${targetId}: ${error instanceof Error ? error.message : String(error)}`);
        return 'audit-unavailable';
    }
}

async function removeBotBansFromGuild(guild: Guild, source = 'sweep'): Promise<number> {
    const bans = await guild.bans.fetch().catch(error => {
        logger.warn(`[BotBanImmunity] Could not inspect bans in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    });
    if (!bans) return 0;

    let removed = 0;
    for (const ban of bans.values()) {
        if (!ban.user.bot) continue;
        const executor = await latestBanExecutor(guild, ban.user.id);
        const ok = await guild.bans.remove(
            ban.user.id,
            'Owner rule: Discord bot accounts must never remain banned',
        ).then(() => true).catch(error => {
            logger.error(`[BotBanImmunity] Failed to unban bot ${ban.user.id} in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (ok) {
            removed += 1;
            logger.error(`[BotBanImmunity] REVERSED bot ban source=${source} user=${ban.user.id} tag=${ban.user.tag} guild=${guild.id} executor=${executor}.`);
        }
    }
    return removed;
}

export async function registerBotBanImmunity(client: Client): Promise<void> {
    installGuildBanCreateGuard();
    if (registered) return;
    registered = true;

    client.on(Events.GuildBanAdd, async ban => {
        if (!ban.user.bot) return;
        const executor = await latestBanExecutor(ban.guild, ban.user.id);
        logger.error(`[BotBanImmunity] BOT BAN DETECTED user=${ban.user.id} tag=${ban.user.tag} guild=${ban.guild.id} executor=${executor}.`);

        const removed = await ban.guild.bans.remove(
            ban.user.id,
            'Owner rule: Discord bot accounts must never remain banned',
        ).then(() => true).catch(error => {
            logger.error(`[BotBanImmunity] Failed to reverse bot ban user=${ban.user.id} guild=${ban.guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (removed) logger.error(`[BotBanImmunity] REVERSED bot ban immediately user=${ban.user.id} guild=${ban.guild.id} executor=${executor}.`);
    });

    let removedTotal = 0;
    for (const guild of client.guilds.cache.values()) {
        removedTotal += await removeBotBansFromGuild(guild, 'startup');
    }

    const sweepTimer = setInterval(() => {
        void (async () => {
            for (const guild of client.guilds.cache.values()) {
                await removeBotBansFromGuild(guild, '30s-sweep');
            }
        })().catch(error => {
            logger.error(`[BotBanImmunity] Scheduled sweep failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
    }, BOT_BAN_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    logger.warn(`[BotBanImmunity] ACTIVE: bot accounts cannot remain banned. startupBotBansRemoved=${removedTotal} sweepEveryMs=${BOT_BAN_SWEEP_INTERVAL_MS}.`);
}
