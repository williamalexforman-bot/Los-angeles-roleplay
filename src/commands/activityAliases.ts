import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { activityCheckCommands } from './activityCheck';

function handlerFor(name: string) {
    const command = activityCheckCommands.find(entry => entry.data.name === name);
    if (!command) throw new Error(`Missing activity-check command handler: ${name}`);
    return command.execute;
}

export const activityCheckAliasCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('activitycheck')
            .setDescription('Start a staff activity check with automatic strikes.')
            .setDMPermission(false)
            .addRoleOption(option => option
                .setName('staff-role')
                .setDescription('Optional staff role override.')
                .setRequired(false))
            .addStringOption(option => option
                .setName('scheduled-end')
                .setDescription('Choose when the check should automatically end.')
                .setRequired(true)
                .addChoices(
                    { name: 'No Scheduled End', value: 'none' },
                    { name: '30 Minutes', value: '30m' },
                    { name: '1 Hour', value: '1h' },
                    { name: '2 Hours', value: '2h' },
                    { name: '4 Hours', value: '4h' },
                    { name: '8 Hours', value: '8h' },
                    { name: '12 Hours', value: '12h' },
                    { name: '24 Hours', value: '24h' },
                )),
        execute: handlerFor('activity-check') as (interaction: ChatInputCommandInteraction) => Promise<void>,
    },
    {
        data: new SlashCommandBuilder()
            .setName('stopactivitycheck')
            .setDescription('End the current activity check and strike non-responders.')
            .setDMPermission(false),
        execute: handlerFor('end-activity-check') as (interaction: ChatInputCommandInteraction) => Promise<void>,
    },
];
