import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction } from 'discord.js';
import { logAction } from '../utils/logger';

// Infraction and promotion commands intentionally live only in
// staffManagement.ts. Keeping legacy definitions here previously left an old
// embed-based promotion path available to accidental importers.
export const staffCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('application')
            .setDescription('Start or review a staff application')
            .addUserOption(option => option.setName('user').setDescription('The user applying').setRequired(true))
            .addStringOption(option => option.setName('type').setDescription('Type of application').setRequired(true))
            .addStringOption(option => option.setName('notes').setDescription('Any notes for the application')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const type = interaction.options.getString('type') || 'staff';
            const notes = interaction.options.getString('notes') || 'No notes';
            logAction('application-request', interaction.user.id, user?.id, type, notes);
            await interaction.reply({ content: `Application request received for ${user?.username ?? 'the user'} (${type}).`, ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('training')
            .setDescription('Manage a training request')
            .addUserOption(option => option.setName('user').setDescription('The user requesting training').setRequired(true))
            .addStringOption(option => option.setName('topic').setDescription('Training topic').setRequired(true))
            .addStringOption(option => option.setName('notes').setDescription('Any notes for the training')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const topic = interaction.options.getString('topic') || 'general';
            const notes = interaction.options.getString('notes') || 'No notes';
            logAction('training-request', interaction.user.id, user?.id, topic, notes);
            await interaction.reply({ content: `Training request received for ${user?.username ?? 'the user'} on ${topic}.`, ephemeral: true });
        },
    },
];
