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
const AUDIT_MATCH_WINDOW_MS = 20_000;
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
        logger.warn(`[BotRemovalImmunity] BLOCKED guild.bans.create target=${targetId}. Discord bans are disabled by owner request.`);
        const error = new Error('Discord bans are disabled by the server owner; bot accounts must never be auto-banned.');
        (error as Error & { code?: string }).code = 'LARP_BOT_BAN_IMMUNITY';
        throw error;
    } as GuildBanManager['create'];

    logger.warn('[BotRemovalImmunity] guild.bans.create guard installed.');
}

function describeExecutor(entry: { executor?: { tag?: string | null; username: string; id: string } | null; executorId?: string | null }): string {
    const executor = entry.executor;
    return executor
        ? `${executor.tag || executor.username}:${executor.id}`
        : `executorId=${entry.executorId || 'unknown'}`;
}

async function latestExecutor(
    guild: Guild,
    targetId: string,
    type: AuditLogEvent.MemberBanAdd | AuditLogEvent.MemberKick,
): Promise<string> {
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 8 });
        const now = Date.now();
        const entry = logs.entries.find(item => {
            if (item.targetId !== targetId) return false;
            const createdAt = item.createdTimestamp || 0;
            return createdAt === 0 || Math.abs(now - createdAt) <= AUDIT_MATCH_WINDOW_MS;
        });
        return entry ? describeExecutor(entry) : 'unknown';
    } catch (error) {
        logger.warn(`[BotRemovalImmunity] Could not read audit log guild=${guild.id} target=${targetId} type=${type}: ${error instanceof Error ? error.message : String(error)}`);
        return 'audit-unavailable';
    }
}

async function latestBanExecutor(guild: Guild, targetId: string): Promise<string> {
    return latestExecutor(guild, targetId, AuditLogEvent.MemberBanAdd);
}

async function latestKickExecutor(guild: Guild, targetId: string): Promise<string> {
    return latestExecutor(guild, targetId, AuditLogEvent.MemberKick);
}

async function removeBotBansFromGuild(guild: Guild, source = 'sweep'): Promise<number> {
    const bans = await guild.bans.fetch().catch(error => {
        logger.warn(`[BotRemovalImmunity] Could not inspect bans in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
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
            logger.error(`[BotRemovalImmunity] Failed to unban bot ${ban.user.id} in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (ok) {
            removed += 1;
            logger.error(`[BotRemovalImmunity] REVERSED bot ban source=${source} user=${ban.user.id} tag=${ban.user.tag} guild=${guild.id} executor=${executor}.`);
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
        logger.error(`[BotRemovalImmunity] BOT BAN DETECTED user=${ban.user.id} tag=${ban.user.tag} guild=${ban.guild.id} executor=${executor}.`);

        const removed = await ban.guild.bans.remove(
            ban.user.id,
            'Owner rule: Discord bot accounts must never remain banned',
        ).then(() => true).catch(error => {
            logger.error(`[BotRemovalImmunity] Failed to reverse bot ban user=${ban.user.id} guild=${ban.guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (removed) logger.error(`[BotRemovalImmunity] REVERSED bot ban immediately user=${ban.user.id} guild=${ban.guild.id} executor=${executor}.`);
    });

    client.on(Events.GuildMemberRemove, member => {
        if (!member.user.bot) return;

        // Discord audit entries can trail the gateway event by a fraction of a second.
        const timer = setTimeout(() => {
            void (async () => {
                const stillBanned = await member.guild.bans.fetch(member.id).then(() => true).catch(() => false);
                if (stillBanned) {
                    const executor = await latestBanExecutor(member.guild, member.id);
                    logger.error(`[BotRemovalImmunity] BOT REMOVED VIA BAN user=${member.id} tag=${member.user.tag} guild=${member.guild.id} executor=${executor}.`);
                    return;
                }

                const executor = await latestKickExecutor(member.guild, member.id);
                if (executor !== 'unknown') {
                    logger.error(`[BotRemovalImmunity] BOT KICK DETECTED user=${member.id} tag=${member.user.tag} guild=${member.guild.id} executor=${executor}.`);
                } else {
                    logger.error(`[BotRemovalImmunity] BOT LEFT/REMOVED user=${member.id} tag=${member.user.tag} guild=${member.guild.id}; no matching kick audit entry found.`);
                }
            })().catch(error => {
                logger.error(`[BotRemovalImmunity] Bot-removal attribution failed user=${member.id} guild=${member.guild.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            });
        }, 1_000);
        timer.unref?.();
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
            logger.error(`[BotRemovalImmunity] Scheduled sweep failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
    }, BOT_BAN_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    logger.warn(`[BotRemovalImmunity] ACTIVE: this runtime cannot intentionally kick/ban Discord bots; bot bans are reversed automatically. startupBotBansRemoved=${removedTotal} sweepEveryMs=${BOT_BAN_SWEEP_INTERVAL_MS}.`);
}
