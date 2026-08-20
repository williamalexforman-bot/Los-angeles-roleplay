import type { ChatInputCommandInteraction } from 'discord.js';
import { moderationCommands } from './moderation';
import { adminCommands } from './admin';
import { staffCommands } from './staff';
import { miscCommands } from './misc';
import { gameCommands } from './game';
import { communityCommands } from './community';
import { staffManagementCommands } from './staffManagement';
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
import { messageQuotaCommands } from './messageQuota';
import { activityCheckCommands } from './activityCheck';
import { activityCheckAliasCommands } from './activityAliases';
import { promotionV2Command } from '../handlers/promotionV2Repair';

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
const retainedPaidAdCommands = paidAdCommands.filter(command => command.data.name !== 'instant-post');
const retainedStaffManagementCommands = staffManagementCommands.filter(command => command.data.name !== 'promotion');

export const commandDefinitions: CommandDefinition[] = [
    ...moderationCommands,
    adminCommands,
    ...retainedStaffCommands,
    ...retainedMiscCommands,
    ...gameCommands,
    ...communityCommands,
    ...retainedStaffManagementCommands,
    promotionV2Command,
    ...messageQuotaCommands,
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

export const commandHandlers = new Map(commandDefinitions.map(command => [command.data.name, command.execute]));
