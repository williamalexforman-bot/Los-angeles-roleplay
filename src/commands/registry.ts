import type { ChatInputCommandInteraction } from 'discord.js';
import { moderationCommands } from './moderation';
import { adminCommands } from './admin';
import { staffCommands } from './staff';
import { miscCommands } from './misc';
import { gameCommands } from './game';
import { ticketCommandDefinitions } from './tickets';
import { data as verificationCommandData, execute as executeVerification } from './verification';
import { communityCommands } from './community';
import { staffManagementCommands } from './staffManagement';
import { prohibitedWordCommand } from './prohibitedWords';
import { sayCommand } from './say';
import { punishmentCommands } from './punishment';
import { data as cmdsCommandData, execute as executeCmds } from './cmds';
import { roleplayLogCommand } from './roleplayLog';
import { activityCheckCommand } from './activityCheck';
import { requestTrainingCommand } from './requestTraining';
import { viewInfractionsCommand } from './viewInfractions';

export interface CommandDefinition {
    data: {
        name: string;
        toJSON(): unknown;
    };
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

const retainedStaffCommands = staffCommands.filter(command =>
    ['application', 'training'].includes(command.data.name)
    && !['infraction', 'promotion'].includes(command.data.name),
);
const retainedMiscCommands = miscCommands.filter(command =>
    !['movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint'].includes(command.data.name)
    && command.data.name !== 'training-result',
);

export const commandDefinitions: CommandDefinition[] = [
    ...moderationCommands,
    adminCommands,
    { data: verificationCommandData, execute: executeVerification as (interaction: ChatInputCommandInteraction) => Promise<unknown> },
    ...retainedStaffCommands,
    ...retainedMiscCommands,
    ...gameCommands,
    ...ticketCommandDefinitions,
    ...communityCommands,
    ...staffManagementCommands,
    sayCommand,
    prohibitedWordCommand,
    ...punishmentCommands,
    roleplayLogCommand,
    activityCheckCommand,
    requestTrainingCommand,
    viewInfractionsCommand,
    { data: cmdsCommandData, execute: executeCmds as (interaction: ChatInputCommandInteraction) => Promise<unknown> },
] as CommandDefinition[];

export const commandHandlers = new Map(commandDefinitions.map(command => [command.data.name, command.execute]));
