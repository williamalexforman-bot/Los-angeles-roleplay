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
                duplicateCommandNames?: string[];
            };
            const count = registry.commandHandlers instanceof Map ? registry.commandHandlers.size : 0;
            const duplicateNames = Array.isArray(registry.duplicateCommandNames) ? registry.duplicateCommandNames : [];
            logger.info(`[SlashCommands] Warmed ${count} canonical command handlers in ${Date.now() - startedAt}ms.`);
            if (duplicateNames.length) {
                logger.warn(`[SlashCommands] Duplicate command definitions collapsed safely: ${duplicateNames.join(', ')}`);
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

    logger.warn('[Recovery] Welcome, Dashboard, Activity Check, voice moderation, presence refreshes, and automatic slash registration remain disabled.');
    logger.warn('[SlashCommands] Automatic Discord command registration remains disabled; existing Discord registrations are preserved.');

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
