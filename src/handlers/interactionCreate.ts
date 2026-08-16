import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    GuildMember,
    Interaction,
    MessageFlags,
    PermissionFlagsBits,
} from 'discord.js';
import { commandHandlers } from '../commands/registry';
import { handleStaffManagementButton, handleStaffManagementModal } from '../commands/staffManagement';
import { handleCommunityButton, handleCommunityModal } from '../commands/community';
import { handleActivityCheckButton } from '../commands/activityCheck';
import { handleTrainingModal } from '../commands/requestTraining';
import { handleLoaButton, handleLoaModal } from '../commands/loa';
import { handleBanAppealButton, handleBanAppealModal } from '../commands/banAppeal';
import { handleInfractionAppealButton, handleInfractionAppealModal } from '../commands/infractionAppeal';
import { handleSessionButton } from '../commands/session';
import { handleTicketButton, handleTicketModal, handleTicketSelect } from '../commands/tickets';
import { handleApplicationButton, handleApplicationSelect } from '../commands/applications';
// economy module removed
import { INFRACTION_AUTHORIZED_ROLE_ID, PROMOTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { logger } from '../utils/logger';

const MANAGEMENT_COMMANDS = new Set([
    'infraction', 'promotion', 'training-results', 'training-result',
    'request-training', 'teamswitch', 'punishment',
]);
const MODERATION_PERMISSIONS = new Map<string, bigint>([
    ['punish', PermissionFlagsBits.ModerateMembers],
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

async function hasManagementCommandPermission(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guildId) return false;
    if (interaction.guild?.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    let roles = new Set(interactionRoleIds(interaction));
    const requiredRoles = interaction.commandName === 'promotion'
        ? [PROMOTION_AUTHORIZED_ROLE_ID]
            : interaction.commandName === 'infraction' || interaction.commandName === 'punishment'
                ? Array.from(new Set([
                    INFRACTION_AUTHORIZED_ROLE_ID,
                    process.env.BOT_PERMISSIONS_ROLE_ID,
                    process.env.ADMIN_ROLE_ID,
                    ...(process.env.INFRACTION_AUTHORIZED_ROLE_IDS || '').split(','),
                ].map(value => value?.trim()).filter((value): value is string => Boolean(value))))
                : [];
    if (requiredRoles.length === 0) return false;
    if (requiredRoles.some(roleId => roles.has(roleId))) return true;
    // The interaction payload may contain partial member data without roles.
    // Fall back to a fresh member fetch so role-gated commands authorize correctly.
    try {
        const guild = interaction.guild;
        if (!guild) return false;
        const fetched = await guild.members.fetch(interaction.user.id);
        roles = new Set([...roles, ...fetched.roles.cache.keys()]);
    } catch {
        // Fall through with whatever roles were already available.
    }
    return requiredRoles.some(roleId => roles.has(roleId));
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
        if (MANAGEMENT_COMMANDS.has(interaction.commandName) && !(await hasManagementCommandPermission(interaction))) {
            await interaction.reply({ content: 'You must be authorized management or a server administrator to use this command.', ephemeral: true });
            return;
        }
        const moderationPermission = MODERATION_PERMISSIONS.get(interaction.commandName);
        if (moderationPermission && !hasModerationCommandPermission(interaction, moderationPermission)) {
            await interaction.reply({ content: 'You do not have permission to use this moderation command.', ephemeral: true });
            return;
        }

        await handler(interaction);
    } catch (error) {
        await reportInteractionError(interaction, error);
    }
}

export const interactionCreate = async (interaction: Interaction): Promise<void> => {
    try {
        if (interaction.isButton()) {
            if (await handleTicketButton(interaction)) return;
            if (await handleApplicationButton(interaction)) return;
            if (await handleActivityCheckButton(interaction)) return;
            if (await handleCommunityButton(interaction)) return;
            if (await handleStaffManagementButton(interaction)) return;
            if (await handleLoaButton(interaction)) return;
            if (await handleBanAppealButton(interaction)) return;
            if (await handleInfractionAppealButton(interaction)) return;
            if (await handleSessionButton(interaction)) return;
            return;
        }

        if (interaction.isModalSubmit()) {
            if (await handleTicketModal(interaction)) return;
            if (await handleTrainingModal(interaction)) return;
            if (await handleCommunityModal(interaction)) return;
            if (await handleStaffManagementModal(interaction)) return;
            if (await handleLoaModal(interaction)) return;
            if (await handleBanAppealModal(interaction)) return;
            if (await handleInfractionAppealModal(interaction)) return;
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (await handleTicketSelect(interaction)) return;
            if (await handleApplicationSelect(interaction)) return;
            return;
        }

        if (interaction.isChatInputCommand()) await handleChatCommand(interaction);
    } catch (error) {
        await reportInteractionError(interaction, error);
    }
};
