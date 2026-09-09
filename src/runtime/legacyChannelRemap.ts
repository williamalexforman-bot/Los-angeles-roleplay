import type { Client, Guild } from 'discord.js';
import { CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const LEGACY_CHANNEL_MAP: Record<string, () => string> = {
    '1526049604712529971': () => CHANNEL_IDS.dashboard,
    '1526034504953892925': () => CHANNEL_IDS.ticketPanel,
    '1526046592187105421': () => CHANNEL_IDS.rules,
    '1526035041593856182': () => CHANNEL_IDS.applications,
    '1526035127606706196': () => CHANNEL_IDS.marketplace,
    '1526036392147423404': () => CHANNEL_IDS.sessionAnnouncements,
    '1526490481398124614': () => CHANNEL_IDS.trainingResults,
    '1526044978109743255': () => CHANNEL_IDS.promotions,
    '1526044664975851642': () => CHANNEL_IDS.infractionParent,
    '1527122924975165530': () => CHANNEL_IDS.partnershipRequests,
};

function remapChannelId(id: unknown): unknown {
    if (typeof id !== 'string') return id;
    const resolver = LEGACY_CHANNEL_MAP[id];
    if (!resolver) return id;
    const next = resolver();
    if (next && next !== id) {
        logger.info(`[LegacyChannelRemap] ${id} -> ${next}`);
        return next;
    }
    return id;
}

function patchManager(manager: any, label: string): void {
    if (!manager || manager.__csrpLegacyRemapPatched) return;
    manager.__csrpLegacyRemapPatched = true;

    if (typeof manager.fetch === 'function') {
        const originalFetch = manager.fetch.bind(manager);
        manager.fetch = (id?: unknown, ...args: unknown[]) => {
            if (typeof id === 'string') return originalFetch(remapChannelId(id), ...args);
            return originalFetch(id, ...args);
        };
    }

    const cache = manager.cache;
    if (cache && typeof cache.get === 'function' && !cache.__csrpLegacyRemapPatched) {
        cache.__csrpLegacyRemapPatched = true;
        const originalGet = cache.get.bind(cache);
        cache.get = (id: unknown) => {
            const mapped = remapChannelId(id);
            return originalGet(mapped) ?? originalGet(id);
        };
    }

    logger.info(`[LegacyChannelRemap] Patched ${label}.`);
}

function patchGuild(guild: Guild): void {
    patchManager(guild.channels, `guild channel manager ${guild.id}`);
}

export function registerLegacyChannelRemap(client: Client): void {
    patchManager(client.channels, 'client channel manager');
    for (const guild of client.guilds.cache.values()) patchGuild(guild);
    client.on('guildCreate', patchGuild);
    logger.info(`[LegacyChannelRemap] Active for ${Object.keys(LEGACY_CHANNEL_MAP).length} retired LARP channel IDs.`);
}
