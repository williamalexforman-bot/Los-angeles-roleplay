import type { Client } from 'discord.js';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';

const COMMAND_PREWARM_DELAY_MS = 1_000;
let commandPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

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

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);

    // Recovery mode intentionally keeps startup quiet. Do not register background
    // listeners, run Discord channel verification, update presence, start ad
    // schedulers, fetch prohibited-word overrides, or perform command-sync REST
    // calls here. Slash interactions get first priority while Render's Discord
    // HTTP egress recovers from the upstream 429 block.
    logger.warn('[Recovery] Core-only startup active: background Discord REST work is disabled.');
    logger.warn('[SlashCommands] Automatic Discord command registration remains disabled; existing Discord registrations are preserved.');

    scheduleCommandPrewarm();

    void connectDatabase().then(available => {
        logger.info(`[Database] ${available ? 'Connected.' : 'Unavailable; Discord remains online.'}`);
    }).catch(error => {
        logger.warn(`[Database] Connection failed without taking Discord offline: ${error instanceof Error ? error.message : String(error)}`);
    });
};
