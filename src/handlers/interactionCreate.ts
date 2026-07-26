import {
    ChatInputCommandInteraction,
    GuildMember,
    Interaction,
    MessageFlags,
    PermissionFlagsBits,
} from 'discord.js';
import { commandHandlers } from '../commands/registry';
import {
    handleTicketButton,
    handleTicketModal,
    ticketOpeningModalForValue,
} from '../commands/tickets';
import { handleStaffManagementButton, handleStaffManagementModal } from '../commands/staffManagement';
import { handleCommunityButton, handleCommunityModal } from '../commands/community';
import { logSlashCommand, takeSlashCommandFailure } from '../utils/commandAudit';
import { logger } from '../utils/logger';

const MANAGEMENT_COMMANDS = new Set(['infraction', 'promotion', 'training-results', 'training-result', 'teamswitch']);
const MODERATION_PERMISSIONS = new Map<string, bigint>([
    ['warn', PermissionFlagsBits.ModerateMembers],
    ['timeout', PermissionFlagsBits.ModerateMembers],
    ['kick', PermissionFlagsBits.KickMembers],
    ['ban', PermissionFlagsBits.BanMembers],
    ['purge', PermissionFlagsBits.ManageMessages],
    ['lock', PermissionFlagsBits.ManageChannels],
    ['unlock', PermissionFlagsBits.ManageChannels],
    ['slowmode', PermissionFlagsBits.ManageChannels],
]);

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
    const member = interaction.member;
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    return member.roles;
}

function hasManagementCommandPermission(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.guildId) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    const configuredRoles = [
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
    ].filter((roleId): roleId is string => Boolean(roleId));
    const roles = new Set(interactionRoleIds(interaction));
    return configuredRoles.some(roleId => roles.has(roleId));
}

function hasSayCommandPermission(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.guildId) return false;
    if (interaction.guild?.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(roleId && interactionRoleIds(interaction).includes(roleId));
}

function hasModerationCommandPermission(interaction: ChatInputCommandInteraction, permission: bigint): boolean {
    if (!interaction.guildId) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(permission)) return true;
    const configuredRoles = [process.env.BOT_PERMISSIONS_ROLE_ID, process.env.ADMIN_ROLE_ID]
        .filter((roleId): roleId is string => Boolean(roleId));
    const roles = new Set(interactionRoleIds(interaction));
    return configuredRoles.some(roleId => roles.has(roleId));
}

async function reportInteractionError(interaction: Interaction, error: unknown): Promise<void> {
    const message = 'There was an error while completing that action. No credentials were exposed. Please try again or contact an administrator.';
    try {
        if (!interaction.isRepliable()) return;
        if (interaction.deferred) await interaction.editReply({ content: message });
        else if (interaction.replied) await interaction.followUp({ content: message, ephemeral: true });
        else await interaction.reply({ content: message, ephemeral: true });
    } catch {
        // The interaction may have expired while an external service was unavailable.
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.error(`Interaction handling failed (${errorName}); details were withheld from logs to protect credentials.`);
}

async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const startedAt = Date.now();
    let success = false;
    let failure: unknown;
    try {
        const handler = commandHandlers.get(interaction.commandName);
        if (!handler) {
            await interaction.reply({ content: 'That command is not currently available.', ephemeral: true });
            return;
        }
        if (interaction.commandName === 'say' && !hasSayCommandPermission(interaction)) {
            await interaction.reply({
                content: 'You must be a server administrator or have the configured bot-permissions role to use this command.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (MANAGEMENT_COMMANDS.has(interaction.commandName) && !hasManagementCommandPermission(interaction)) {
            await interaction.reply({ content: 'You must be authorized management or a server administrator to use this command.', ephemeral: true });
            return;
        }
        const moderationPermission = MODERATION_PERMISSIONS.get(interaction.commandName);
        if (moderationPermission && !hasModerationCommandPermission(interaction, moderationPermission)) {
            await interaction.reply({ content: 'You do not have permission to use this moderation command.', ephemeral: true });
            return;
        }
        await handler(interaction);
        success = true;
    } catch (error) {
        failure = error;
        await reportInteractionError(interaction, error);
    } finally {
        const handledFailure = takeSlashCommandFailure(interaction);
        if (handledFailure !== undefined) {
            success = false;
            failure = failure ?? handledFailure;
        }
        await logSlashCommand(interaction, startedAt, success, failure);
    }
}

export const interactionCreate = async (interaction: Interaction): Promise<void> => {
    try {
        if (interaction.isButton()) {
            if (await handleCommunityButton(interaction)) return;
            if (await handleTicketButton(interaction)) return;
            if (await handleStaffManagementButton(interaction)) return;
            return;
        }

        if (interaction.isModalSubmit()) {
            if (await handleCommunityModal(interaction)) return;
            if (await handleTicketModal(interaction)) return;
            if (await handleStaffManagementModal(interaction)) return;
            return;
        }

        // Compatibility for panels posted by older versions of this bot.
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
            const modal = ticketOpeningModalForValue(interaction.values[0]);
            if (modal) await interaction.showModal(modal);
            else await interaction.reply({ content: 'That ticket category is unavailable.', ephemeral: true });
            return;
        }

        if (interaction.isChatInputCommand()) await handleChatCommand(interaction);
    } catch (error) {
        await reportInteractionError(interaction, error);
    }
};
