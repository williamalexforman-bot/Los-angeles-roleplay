import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { sendToChannel } from '../utils/notify';

export const miscCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('movie-feedback')
            .setDescription('Send movie feedback')
            .addStringOption(opt => opt.setName('message').setDescription('Feedback message').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const msg = interaction.options.getString('message') ?? '';
            await sendToChannel(interaction.client, process.env.MOVIE_FEEDBACK_CHANNEL_ID || '', `Movie feedback from <@${interaction.user.id}>: ${msg}`);
            await interaction.reply({ content: 'Movie feedback sent.', ephemeral: true });
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('staff-feedback')
            .setDescription('Send staff feedback')
            .addStringOption(opt => opt.setName('message').setDescription('Feedback message').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const msg = interaction.options.getString('message') ?? '';
            await sendToChannel(interaction.client, process.env.STAFF_FEEDBACK_CHANNEL_ID || '', `Staff feedback from <@${interaction.user.id}>: ${msg}`);
            await interaction.reply({ content: 'Staff feedback sent.', ephemeral: true });
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('partnership')
            .setDescription('Request a partnership')
            .addStringOption(opt => opt.setName('details').setDescription('Partnership details').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const details = interaction.options.getString('details') ?? '';
            await sendToChannel(interaction.client, process.env.PARTNERSHIP_APPROVAL_CHANNEL_ID || '', `Partnership request from <@${interaction.user.id}>: ${details}`);
            await sendToChannel(interaction.client, process.env.PARTNERSHIP_REQUEST_CHANNEL_ID || '', `Partnership request logged: ${details}`);
            await interaction.reply({ content: 'Partnership request sent.', ephemeral: true });
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('staff-complaint')
            .setDescription('Submit a staff complaint')
            .addStringOption(opt => opt.setName('details').setDescription('Complaint details').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const details = interaction.options.getString('details') ?? '';
            await sendToChannel(interaction.client, process.env.STAFF_COMPLAINT_CHANNEL_ID || '', `Staff complaint from <@${interaction.user.id}>: ${details}`);
            await interaction.reply({ content: 'Staff complaint submitted.', ephemeral: true });
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('training-result')
            .setDescription('Post an authorized legacy/manual training result')
            .addStringOption(opt => opt.setName('result').setDescription('Result details').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const result = interaction.options.getString('result') ?? '';
            await sendToChannel(
                interaction.client,
                process.env.TRAINING_RESULTS_CHANNEL_ID || '',
                `Manual legacy training result submitted by authorized management (<@${interaction.user.id}>): ${result}`,
            );
            await interaction.reply({ content: 'Manual legacy training result sent.', ephemeral: true });
        }
    }
];
