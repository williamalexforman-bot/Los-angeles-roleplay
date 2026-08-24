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
import { accountInfoCommands } from './accountInfo';
import { suggestionCommands } from './suggestions';
import { dashboardCommand } from './dashboard';
import { partnershipV2Command } from '../handlers/partnershipV2Command';
import { handleEnhancedSessionCommand } from './sessionEnhancements';
import { viewCommand } from './view';

export interface CommandDefinition {
    data: {
        name: string;
        toJSON(): unknown;
    };
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

interface SourcedCommandDefinition {
    source: string;
    command: CommandDefinition;
}

const retainedStaffCommands = staffCommands.filter(command =>
    ['application', 'training'].includes(command.data.name),
);
const retainedMiscCommands = miscCommands.filter(command =>
    !['movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint'].includes(command.data.name)
    && command.data.name !== 'training-result',
);
const retainedCommunityCommands = communityCommands.filter(command => command.data.name !== 'partnership');
const retainedStaffManagementCommands = staffManagementCommands.filter(command => command.data.name !== 'promotion');

const sourcedDefinitions: SourcedCommandDefinition[] = [];
function addCommands(source: string, commands: CommandDefinition | readonly CommandDefinition[]): void {
    const list = Array.isArray(commands) ? commands : [commands];
    for (const command of list) sourcedDefinitions.push({ source, command });
}

addCommands('moderation', moderationCommands);
addCommands('admin', adminCommands);
addCommands('staff', retainedStaffCommands);
addCommands('misc', retainedMiscCommands);
addCommands('game', gameCommands);
addCommands('community', retainedCommunityCommands);
addCommands('partnershipV2', partnershipV2Command);
addCommands('dashboard', dashboardCommand);
addCommands('staffManagement', retainedStaffManagementCommands);
addCommands('promotionRoleSwap', promotionRoleSwapCommand);
addCommands('say', sayCommand);
addCommands('prohibitedWords', prohibitedWordCommand);
addCommands('punishment', punishmentCommands);
addCommands('roleplayLog', roleplayLogCommand);
addCommands('requestTraining', requestTrainingCommand);
addCommands('viewInfractions', viewInfractionsCommand);
addCommands('loa', loaCommand);
addCommands('rename', renameCommand);
addCommands('session', sessionCommands.map(command => {
    if (!['session-start', 'session-vote'].includes(command.data.name)) return command;
    return {
        data: command.data,
        async execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
            if (await handleEnhancedSessionCommand(interaction)) return;
            return command.execute(interaction);
        },
    };
}));
addCommands('view', viewCommand);
addCommands('tickets', ticketCommands);
addCommands('applications', applicationsPanelCommand);
addCommands('role', roleCommand);
addCommands('marketplace', marketplacePanelCommand);
addCommands('erlcUtilities', erlcUtilityCommands);
addCommands('dockConfig', dockConfigCommand);
addCommands('accountInfo', accountInfoCommands);
addCommands('suggestions', suggestionCommands);
addCommands('cmds', { data: cmdsCommandData, execute: executeCmds as (interaction: ChatInputCommandInteraction) => Promise<unknown> });

const canonicalByName = new Map<string, CommandDefinition>();
const sourceByName = new Map<string, string>();
const duplicateSources = new Map<string, string[]>();

for (const { source, command } of sourcedDefinitions) {
    const name = command?.data?.name;
    if (!name || typeof command.execute !== 'function') continue;

    if (canonicalByName.has(name)) {
        const sources = duplicateSources.get(name) || [sourceByName.get(name) || 'unknown'];
        sources.push(source);
        duplicateSources.set(name, sources);
        continue;
    }

    canonicalByName.set(name, command);
    sourceByName.set(name, source);
}

export const duplicateCommandNames = [...duplicateSources.keys()].sort();
export const duplicateCommandSources = Object.fromEntries(
    [...duplicateSources.entries()].map(([name, sources]) => [name, [...new Set(sources)]]),
);
export const commandDefinitions: CommandDefinition[] = [...canonicalByName.values()];
export const commandHandlers = new Map(
    commandDefinitions.map(command => [command.data.name, command.execute]),
);
