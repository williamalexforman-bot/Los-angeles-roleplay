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
import { handleTrainingModal } from '../commands/requestTraining';
import { handleLoaButton, handleLoaModal } from '../commands/loa';
import { handleBanAppealButton, handleBanAppealModal } from '../commands/banAppeal';
import { handleInfractionAppealButton, handleInfractionAppealModal } from '../commands/infractionAppeal';
import { handleMessageQuotaButton, handleMessageQuotaModal } from '../commands/messageQuota';
import { activityCheckCommands, handleActivityCheckButton } from '../commands/activityCheck';
import { handleSessionButton } from '../commands/session';
import { handleEnhancedSessionButton, handleEnhancedSessionCommand } from '../commands/sessionEnhancements';
import { handlePaidAdButton, handlePaidAdModal, handlePaidAdSelect } from '../commands/paidAds';
import { handleAdvancedPaidAdSelect, normalizePaidAdSchedule } from '../commands/advancedPaidAds';
import { handleSuggestionButton } from '../commands/suggestions';
import {
    handleTicketButton,
    handleTicketModal,
    handleTicketSelect,
    isTicketPanelCommandName,
    postTicketPanel,
} from '../commands/tickets';
import { handleApplicationButton, handleApplicationModal, handleApplicationSelect } from '../commands/applications';
import { roleCommand } from '../commands/role';
import {
    INFRACTION_AUTHORIZED_ROLE_ID,
    PROMOTION_AUTHORIZED_ROLE_ID,
    SESSION_START_AUTHORIZED_ROLE_ID,
    TRAINING_RESULTS_AUTHORIZED_ROLE_ID,
} from '../config/constants';
import { logger } from '../utils/logger';

const TRAINING_DEPARTMENT_ROLE_ID = '1524013351850737835';

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

const directActivityHandlers = new Map(
    activityCheckCommands.map(command => [command.data.name, command.execute] as const),
);

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
    const member = interaction.member;
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    return member.roles;
}

function configuredRoleIds(...values: Array<string | undefined>): string[] {
    return Array.from(new Set(
        values
            .flatMap(value => (value || '').split(','))
            .map(value => value.trim())
            .filter(Boolean),
    ));
}

async function hasManagementCommandPermission(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guildId) return false;

    let requiredRoles: string[];
    switch (interaction.commandName) {
        case 'session-start':
            requiredRoles = [SESSION_START_AUTHORIZED_ROLE_ID];
            break;
        case 'promotion':
            requiredRoles = [PROMOTION_AUTHORIZED_ROLE_ID];
            break;
        case 'infraction':
            requiredRoles = [INFRACTION_AUTHORIZED_ROLE_ID];
            break;
        case 'punishment':
            requiredRoles = configuredRoleIds(
                INFRACTION_AUTHORIZED_ROLE_ID,
                process.env.BOT_PERMISSIONS_ROLE_ID,
                process.env.ADMIN_ROLE_ID,
                process.env.INFRACTION_AUTHORIZED_ROLE_IDS,
            );
            break;
        case 'training-results':
        case 'training-result':
            requiredRoles = [TRAINING_RESULTS_AUTHORIZED_ROLE_ID];
            break;
        case 'request-training':
            requiredRoles = configuredRoleIds(
                TRAINING_DEPARTMENT_ROLE_ID,
                process.env.BOT_PERMISSIONS_ROLE_ID,
                process.env.ADMIN_ROLE_ID,
            );
            break;
        case 'teamswitch':
            requiredRoles = configuredRoleIds(
                process.env.BOT_PERMISSIONS_ROLE_ID,
                process.env.ADMIN_ROLE_ID,
            );
            break;
        default:
            return false;
    }

    const exactRoleCommand = interaction.commandName === 'session-start'
        || interaction.commandName === 'promotion'
        || interaction.commandName === 'infraction'
        || interaction.commandName === 'training-results'
        || interaction.commandName === 'training-result';
    if (!exactRoleCommand && (interaction.guild?.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))) return true;

    if (requiredRoles.length === 0) return false;

    let roles = new Set(interactionRoleIds(interaction));
    if (requiredRoles.some(roleId => roles.has(roleId))) return true;

    try {
        const guild = interaction.guild;
        if (!guild) return false;
        const fetched = await guild.members.fetch(interaction.user.id);
        roles = new Set([...roles, ...fetched.roles.cache.keys()]);
    } catch {
        // Fall through with cached roles.
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
        // Interaction may have expired.
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.error(`Interaction handling failed (${errorName}); details were withheld from logs to protect credentials.`);
}

async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        if (isTicketPanelCommandName(interaction.commandName)) {
            await postTicketPanel(interaction);
            return;
        }
        if (interaction.commandName === 'session-start') {
            const allowed = await hasManagementCommandPermission(interaction);
            if (!allowed) {
                await interaction.reply({
                    content: `You need <@&${SESSION_START_AUTHORIZED_ROLE_ID}> to start a session.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        }
        if (await handleEnhancedSessionCommand(interaction)) return;
        if (interaction.commandName === 'role') {
            await roleCommand.execute(interaction);
            return;
        }

        const directActivityHandler = directActivityHandlers.get(interaction.commandName);
        if (directActivityHandler) {
            await directActivityHandler(interaction);
            return;
        }

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
            const exactRole = interaction.commandName === 'infraction'
                ? INFRACTION_AUTHORIZED_ROLE_ID
                : interaction.commandName === 'promotion'
                    ? PROMOTION_AUTHORIZED_ROLE_ID
                    : interaction.commandName === 'training-results' || interaction.commandName === 'training-result'
                        ? TRAINING_RESULTS_AUTHORIZED_ROLE_ID
                        : null;
            await interaction.reply({
                content: exactRole
                    ? `You need <@&${exactRole}> to use this command.`
                    : 'You must be authorized management or a server administrator to use this command.',
                ephemeral: true,
            });
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
            if (await handleActivityCheckButton(interaction)) return;
            if (await handleMessageQuotaButton(interaction)) return;
            if (await handleSuggestionButton(interaction)) return;
            if (await handlePaidAdButton(interaction)) return;
            if (await handleTicketButton(interaction)) return;
            if (await handleApplicationButton(interaction)) return;
            if (await handleCommunityButton(interaction)) return;
            if (await handleStaffManagementButton(interaction)) return;
            if (await handleLoaButton(interaction)) return;
            if (await handleBanAppealButton(interaction)) return;
            if (await handleInfractionAppealButton(interaction)) return;
            if (await handleEnhancedSessionButton(interaction)) return;
            if (await handleSessionButton(interaction)) return;
            return;
        }

        if (interaction.isModalSubmit()) {
            if (await handleMessageQuotaModal(interaction)) return;
            if (await handlePaidAdModal(interaction)) {
                await normalizePaidAdSchedule(interaction.client).catch(error => {
                    logger.warn(`[PaidAdV2] Could not normalize after setup: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
                return;
            }
            if (await handleApplicationModal(interaction)) return;
            if (await handleTicketModal(interaction)) return;
            if (await handleTrainingModal(interaction)) return;
            if (await handleCommunityModal(interaction)) return;
            if (await handleStaffManagementModal(interaction)) return;
            if (await handleLoaModal(interaction)) return;
            if (await handleBanAppealModal(interaction)) return;
            if (await handleInfractionAppealModal(interaction)) return;
            return;
        }

        if ('isUserSelectMenu' in interaction && interaction.isUserSelectMenu()) return;

        if (interaction.isStringSelectMenu()) {
            if (await handleAdvancedPaidAdSelect(interaction)) return;
            if (await handlePaidAdSelect(interaction)) return;
            if (await handleTicketSelect(interaction)) return;
            if (await handleApplicationSelect(interaction)) return;
            return;
        }

        if (interaction.isChatInputCommand()) await handleChatCommand(interaction);
    } catch (error) {
        await reportInteractionError(interaction, error);
    }
};
