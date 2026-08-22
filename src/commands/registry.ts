import type { ChatInputCommandInteraction } from 'discord.js';
import { moderationCommands } from './moderation';
import { adminCommands } from './admin';
import { staffCommands } from './staff';
import { miscCommands } from './misc';
import { gameCommands } from './game';
import { communityCommands } from './community';
import { staffManagementCommands } from './staffManagement';
import { promotionRoleSwapCommand } from './promotionRoleSwap';
import { prohibitedWordCommand } from './prohibitedWords';
import { sayCommand } from './say';
import { punishmentCommands } from './punishment';
import { data as cmdsCommandData, execute as executeCmds } from './cmds';
import { roleplayLogCommand } from './roleplayLog';
import { requestTrainingCommand } from './requestTraining';
import { viewInfractionsCommand } from './viewInfractions';
import { loaCommand } from './loa';
import { renameCommand } from './rename';
import { sessionCommands } from './session';
import { ticketCommands } from './tickets';
import { applicationsPanelCommand } from './applications';
import { roleCommand } from './role';
import { marketplacePanelCommand } from './marketplace';
import { erlcUtilityCommands } from './erlcUtilities';
import { dockConfigCommand } from './dockConfig';
import { paidAdCommands } from './paidAds';
import { advancedInstantPostCommand } from './advancedPaidAds';
import { accountInfoCommands } from './accountInfo';
import { suggestionCommands } from './suggestions';
import { activityCheckCommands } from './activityCheck';
import { activityCheckAliasCommands } from './activityAliases';
import { dashboardCommand } from './dashboard';

export interface CommandDefinition {
    data: {
        name: string;
        toJSON(): unknown;
    };
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

const retainedStaffCommands = staffCommands.filter(command =>
    ['application', 'training'].includes(command.data.name),
);
const retainedMiscCommands = miscCommands.filter(command =>
    !['movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint'].includes(command.data.name)
    && command.data.name !== 'training-result',
);
const retainedStaffManagementCommands = staffManagementCommands.filter(command => command.data.name !== 'promotion');
const retainedPaidAdCommands = paidAdCommands.filter(command => command.data.name !== 'instant-post');

const rawCommandDefinitions: CommandDefinition[] = [
    ...moderationCommands,
    adminCommands,
    ...retainedStaffCommands,
    ...retainedMiscCommands,
    ...gameCommands,
    ...communityCommands,
    ...retainedStaffManagementCommands,
    promotionRoleSwapCommand,
    ...activityCheckCommands,
    ...activityCheckAliasCommands,
    sayCommand,
    prohibitedWordCommand,
    ...punishmentCommands,
    roleplayLogCommand,
    requestTrainingCommand,
    viewInfractionsCommand,
    loaCommand,
    renameCommand,
    ...sessionCommands,
    ...ticketCommands,
    applicationsPanelCommand,
    dashboardCommand,
    roleCommand,
    marketplacePanelCommand,
    ...erlcUtilityCommands,
    dockConfigCommand,
    ...retainedPaidAdCommands,
    advancedInstantPostCommand,
    ...accountInfoCommands,
    ...suggestionCommands,
    { data: cmdsCommandData, execute: executeCmds as (interaction: ChatInputCommandInteraction) => Promise<unknown> },
] as CommandDefinition[];

// Keep exactly one local definition for each slash-command name. The registry
// historically contained overlapping command packs; Map assignment makes the
// later/current definition authoritative, matching the old commandHandlers
// behavior while preventing duplicate schemas from reaching Discord.
const canonicalByName = new Map<string, CommandDefinition>();
const duplicateNames = new Set<string>();
for (const command of rawCommandDefinitions) {
    if (canonicalByName.has(command.data.name)) duplicateNames.add(command.data.name);
    canonicalByName.set(command.data.name, command);
}

export const duplicateCommandNames = Object.freeze([...duplicateNames].sort());
export const commandDefinitions: CommandDefinition[] = [...canonicalByName.values()];

// Normal slash commands should never be allowed to finish silently. If an old
// or partially migrated handler returns without replying, deferring, or opening
// a modal, acknowledge it here so Discord does not show “This application did
// not respond.” Critical ticket/application/activity routes still use their
// dedicated stable handlers before this map is reached.
export const commandHandlers = new Map(
    commandDefinitions.map(command => [
        command.data.name,
        async (interaction: ChatInputCommandInteraction): Promise<unknown> => {
            const result = await command.execute(interaction);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '✅ Command received. This command completed without returning its normal response.',
                    ephemeral: true,
                }).catch(() => undefined);
            }
            return result;
        },
    ]),
);
