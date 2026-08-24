import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import { logger } from '../utils/logger';
import { interactionCreateStable } from './interactionCreateStable';

const CRITICAL_COMMANDS = new Set([
    'ticket',
    'ticket-panel',
    'ticketpanel',
    'close',
    'closerequest',
    'unclaim',
    'applications-panel',
]);

async function tryRegistryFallback(interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        const registry = require('../commands/registry.ts') as {
            commandHandlers?: Map<string, (i: ChatInputCommandInteraction) => Promise<unknown>>;
            commandDefinitions?: Array<{
                data?: { name?: string };
                execute?: (i: ChatInputCommandInteraction) => Promise<unknown>;
            }>;
        };

        let handler = registry.commandHandlers?.get?.(interaction.commandName);
        if (!handler && Array.isArray(registry.commandDefinitions)) {
            const definition = registry.commandDefinitions.find(command => command?.data?.name === interaction.commandName);
            if (typeof definition?.execute === 'function') handler = definition.execute;
        }

        if (!handler) {
            logger.error(
                `[InteractionBridge] Registry miss for /${interaction.commandName}; handlers=${registry.commandHandlers?.size ?? 'n/a'} definitions=${registry.commandDefinitions?.length ?? 'n/a'}.`,
            );
            return false;
        }

        await handler(interaction);
        return true;
    } catch (error) {
        logger.error(`[InteractionBridge] Registry fallback failed for /${interaction.commandName}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        return false;
    }
}

export async function interactionCreate(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand() && !CRITICAL_COMMANDS.has(interaction.commandName)) {
        if (await tryRegistryFallback(interaction)) return;
    }

    await interactionCreateStable(interaction);
}
