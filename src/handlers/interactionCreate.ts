import {
    MessageFlags,
    PermissionFlagsBits,
    type ChatInputCommandInteraction,
    type Interaction,
} from 'discord.js';
import {
    INFRACTION_AUTHORIZED_ROLE_ID,
    PROMOTION_AUTHORIZED_ROLE_ID,
    SESSION_START_AUTHORIZED_ROLE_ID,
    TRAINING_RESULTS_AUTHORIZED_ROLE_ID,
} from '../config/constants';
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

const EXACT_COMMAND_ROLE = new Map<string, string>([
    ['session-start', SESSION_START_AUTHORIZED_ROLE_ID],
    ['session-end', SESSION_START_AUTHORIZED_ROLE_ID],
    ['promotion', PROMOTION_AUTHORIZED_ROLE_ID],
    ['infraction', INFRACTION_AUTHORIZED_ROLE_ID],
    ['training-results', TRAINING_RESULTS_AUTHORIZED_ROLE_ID],
    ['training-result', TRAINING_RESULTS_AUTHORIZED_ROLE_ID],
]);

function roleIds(member: ChatInputCommandInteraction['member']): string[] {
    if (!member) return [];
    if (Array.isArray(member.roles)) return member.roles;
    return [...member.roles.cache.keys()];
}

async function enforceExactCommandRole(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const requiredRoleId = EXACT_COMMAND_ROLE.get(interaction.commandName);
    if (!requiredRoleId) return false;

    let allowed = roleIds(interaction.member).includes(requiredRoleId);
    if (!allowed && interaction.guild) {
        const refreshed = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        allowed = roleIds(refreshed).includes(requiredRoleId);
    }
    if (allowed) return false;

    await interaction.reply({
        content: `You need <@&${requiredRoleId}> to use this command.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function enforceSayCommandPermission(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName !== 'say') return false;

    const isAdministrator = interaction.guild?.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const botPermissionsRoleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    const hasConfiguredRole = Boolean(
        botPermissionsRoleId && roleIds(interaction.member).includes(botPermissionsRoleId),
    );
    if (interaction.guildId && (isAdministrator || hasConfiguredRole)) return false;

    await interaction.reply({
        content: 'You must be a server administrator or have the configured bot-permissions role to use this command.',
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function tryRegistryFallback(interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        if (await enforceSayCommandPermission(interaction)) return true;
        if (await enforceExactCommandRole(interaction)) return true;

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
