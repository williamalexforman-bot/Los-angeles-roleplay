import { ActivityType, type Client } from 'discord.js';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { registerTicketPriority } from './ticketPriority';
import { registerRaidProtection } from './raidProtection';
import { registerInfractionAppealExpiry } from './infractionAppealExpiry';
import { registerLoaLifecycleEnhancements } from './loaLifecycleEnhancements';
import { registerLegacyLoaActiveMigration } from './loaActiveMigration';
import { registerLoaCalendarRequest } from './loaCalendarRequest';
import { registerLoaApprovalGuard } from './loaApprovalGuard';
import { installBatchOneBannerAssets } from './bannerAssetInstaller';
import { refreshPersistentPanels } from './persistentPanelRefresh';

const COMMAND_PREWARM_DELAY_MS = 1_000;
let commandPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

function getTotalMemberCount(client: Client): number {
    return client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
}

function updateMemberCountPresence(client: Client): void {
    if (!client.user) return;
    const memberCount = getTotalMemberCount(client);
    const label = `${memberCount.toLocaleString()} ${memberCount === 1 ? 'member' : 'members'}`;
    try {
        client.user.setPresence({
            status: 'online',
            activities: [{ name: label, type: ActivityType.Watching }],
        });
        logger.info(`[Presence] Watching ${label}.`);
    } catch (error) {
        logger.warn(`[Presence] Could not update member-count activity: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function registerMemberCountPresence(client: Client): void {
    updateMemberCountPresence(client);
    client.on('guildCreate', () => updateMemberCountPresence(client));
    client.on('guildDelete', () => updateMemberCountPresence(client));
    const presenceRefreshTimer = setInterval(() => updateMemberCountPresence(client), 5 * 60 * 1000);
    presenceRefreshTimer.unref?.();
}

function scheduleCommandPrewarm(): void {
    if (commandPrewarmTimer) clearTimeout(commandPrewarmTimer);
    commandPrewarmTimer = setTimeout(() => {
        commandPrewarmTimer = null;
        const startedAt = Date.now();
        try {
            const registry = require('../commands/registry.ts') as {
                commandHandlers?: Map<string, unknown>;
                commandDefinitions?: Array<{
                    data?: { name?: string; toJSON?: () => unknown };
                    execute?: unknown;
                }>;
                duplicateCommandNames?: string[];
                duplicateCommandSources?: Record<string, string[]>;
            };
            const count = registry.commandHandlers instanceof Map ? registry.commandHandlers.size : 0;
            const duplicateNames = Array.isArray(registry.duplicateCommandNames) ? registry.duplicateCommandNames : [];
            const definitions = Array.isArray(registry.commandDefinitions) ? registry.commandDefinitions : [];
            logger.info(`[SlashCommands] Warmed ${count} canonical command handlers in ${Date.now() - startedAt}ms.`);

            if (duplicateNames.length) {
                for (const name of duplicateNames) {
                    const sources = registry.duplicateCommandSources?.[name] || [];
                    logger.warn(`[SlashCommands] Duplicate /${name} rejected. First handler kept; sources=${sources.join(' -> ') || 'unknown'}.`);
                }
            } else {
                logger.info('[SlashCommands] Duplicate audit passed: every active slash-command name is unique.');
            }

            const failures: string[] = [];
            const checkedNames: string[] = [];
            for (const definition of definitions) {
                const name = definition?.data?.name || '<unnamed>';
                checkedNames.push(name);
                if (typeof definition.execute !== 'function') {
                    failures.push(`/${name}: execute handler is not a function`);
                    continue;
                }
                if (typeof definition.data?.toJSON !== 'function') {
                    failures.push(`/${name}: slash-command schema has no toJSON()`);
                    continue;
                }
                try {
                    const json = definition.data.toJSON() as { name?: string };
                    if (!json || json.name !== name) failures.push(`/${name}: schema name mismatch`);
                } catch (error) {
                    failures.push(`/${name}: schema serialization failed (${error instanceof Error ? error.message : String(error)})`);
                }
                if (!registry.commandHandlers?.has(name)) failures.push(`/${name}: missing from commandHandlers map`);
            }

            if (failures.length) {
                logger.error(`[SlashCommands] FULL COMMAND AUDIT FAILED (${failures.length} issue(s)): ${failures.join(' | ')}`);
            } else {
                logger.info(`[SlashCommands] FULL COMMAND AUDIT PASSED: ${checkedNames.length} commands have valid schemas and callable handlers.`);
            }
        } catch (error) {
            logger.error(`[SlashCommands] Command warmup failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        }
    }, COMMAND_PREWARM_DELAY_MS);
    commandPrewarmTimer.unref?.();
}

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);

    try {
        // Finish rendering the 1920px high-quality copies before any persistent
        // Discord message is refreshed, otherwise the refresh can reattach the
        // old low-resolution file while Sharp is still processing it.
        await installBatchOneBannerAssets();
    } catch (error) {
        logger.warn(`[Banners] Full banner install failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        await refreshPersistentPanels(client);
    } catch (error) {
        logger.warn(`[Banners] Persistent panel refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        registerMemberCountPresence(client);
        logger.info('[Presence] Member-count watching activity enabled.');
    } catch (error) {
        logger.warn(`[Presence] Failed to register member-count activity: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        registerTicketPriority(client);
        logger.info('[Tickets] Priority channel naming enabled.');
    } catch (error) {
        logger.warn(`[Tickets] Priority naming failed to register: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        registerRaidProtection(client);
        logger.info('[Raid Protection] Runtime protection enabled.');
    } catch (error) {
        logger.warn(`[Raid Protection] Failed to register: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        registerInfractionAppealExpiry(client);
    } catch (error) {
        logger.warn(`[InfractionAppeal] Failed to register 24-hour expiry watcher: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        registerLoaLifecycleEnhancements(client);
        registerLoaCalendarRequest();
        registerLoaApprovalGuard();
        registerLegacyLoaActiveMigration(client);
        logger.info('[LOA] Enhanced lifecycle, calendar request picker, approval guard, and active-LOA migration enabled.');
    } catch (error) {
        logger.warn(`[LOA] Failed to register enhanced lifecycle: ${error instanceof Error ? error.message : String(error)}`);
    }

    scheduleCommandPrewarm();
    logger.info('[SlashCommands] Startup command re-upload is off; runtime handlers are loaded locally.');

    void connectDatabase().then(async available => {
        logger.info(`[Database] ${available ? 'Connected.' : 'Unavailable; Discord remains online.'}`);
        if (!available) return;
        try {
            await loadProhibitedWordOverrides([...client.guilds.cache.keys()]);
            logger.info('[MessageModeration] Persistent prohibited-word overrides loaded.');
        } catch (error) {
            logger.warn(`[MessageModeration] Could not load prohibited-word overrides: ${error instanceof Error ? error.message : String(error)}`);
        }
    }).catch(error => {
        logger.warn(`[Database] Startup connection attempt failed without taking Discord offline: ${error instanceof Error ? error.message : String(error)}`);
    });
};
