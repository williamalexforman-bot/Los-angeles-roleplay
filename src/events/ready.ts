import type { Client } from 'discord.js';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';
import { startAdvancedPaidAdScheduler } from '../commands/advancedPaidAds';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { registerTicketAiTriage } from './ticketAiTriage';
import { registerTicketPriority } from './ticketPriority';
import { registerRaidProtection } from './raidProtection';

const COMMAND_PREWARM_DELAY_MS = 1_000;
const PAID_AD_STARTUP_DELAY_MS = 5 * 60_000;
let commandPrewarmTimer: ReturnType<typeof setTimeout> | null = null;
let paidAdStartupTimer: ReturnType<typeof setTimeout> | null = null;

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

function schedulePaidAds(client: Client): void {
    if (paidAdStartupTimer) clearTimeout(paidAdStartupTimer);
    paidAdStartupTimer = setTimeout(() => {
        paidAdStartupTimer = null;
        try {
            startAdvancedPaidAdScheduler(client);
            logger.info('[PaidAds] Advanced paid-ad scheduler started.');
        } catch (error) {
            logger.warn(`[PaidAds] Scheduler failed to start without affecting commands: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, PAID_AD_STARTUP_DELAY_MS);
    paidAdStartupTimer.unref?.();
    logger.info('[PaidAds] Scheduler will start 5 minutes after READY so slash commands get priority.');
}

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);

    try {
        registerTicketAiTriage(client);
        logger.info('[Tickets] Pre-claim AI triage enabled.');
    } catch (error) {
        logger.warn(`[Tickets] AI triage failed to register: ${error instanceof Error ? error.message : String(error)}`);
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

    schedulePaidAds(client);
    scheduleCommandPrewarm();

    // Slash commands are intentionally not re-uploaded during startup. Existing
    // Discord registrations remain untouched so startup does not add REST load.
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
        logger.warn(`[Database] Connection failed without taking Discord offline: ${error instanceof Error ? error.message : String(error)}`);
    });
};
