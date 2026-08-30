import {
    Events,
    GuildBanManager,
    type Client,
    type Guild,
} from 'discord.js';
import { logger } from '../utils/logger';

const PATCH_KEY = Symbol.for('larp.permanentBotBanImmunity');
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

async function removeBotBansFromGuild(guild: Guild): Promise<number> {
    const bans = await guild.bans.fetch().catch(error => {
        logger.warn(`[BotBanImmunity] Could not inspect bans in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    });
    if (!bans) return 0;

    let removed = 0;
    for (const ban of bans.values()) {
        if (!ban.user.bot) continue;
        const ok = await guild.bans.remove(ban.user.id, 'Owner rule: Discord bot accounts must never remain banned').then(() => true).catch(error => {
            logger.error(`[BotBanImmunity] Failed to unban bot ${ban.user.id} in guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (ok) {
            removed += 1;
            logger.warn(`[BotBanImmunity] REMOVED existing bot ban user=${ban.user.id} guild=${guild.id}.`);
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
        const removed = await ban.guild.bans.remove(
            ban.user.id,
            'Owner rule: Discord bot accounts must never remain banned',
        ).then(() => true).catch(error => {
            logger.error(`[BotBanImmunity] Failed to reverse bot ban user=${ban.user.id} guild=${ban.guild.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        if (removed) logger.warn(`[BotBanImmunity] REVERSED bot ban immediately user=${ban.user.id} guild=${ban.guild.id}.`);
    });

    let removedTotal = 0;
    for (const guild of client.guilds.cache.values()) {
        removedTotal += await removeBotBansFromGuild(guild);
    }

    logger.warn(`[BotBanImmunity] ACTIVE: bot accounts cannot remain banned. startupBotBansRemoved=${removedTotal}.`);
}
