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
            await sendToChannel(interaction.client, '1528933044310904884', `Movie feedback from <@${interaction.user.id}>: ${msg}`);
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
            await sendToChannel(interaction.client, '1526041844515868745', `Staff feedback from <@${interaction.user.id}>: ${msg}`);
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
            await sendToChannel(interaction.client, '1526042350802043022', `Partnership request from <@${interaction.user.id}>: ${details}`);
            await sendToChannel(interaction.client, '1527122924975165530', `Partnership request logged: ${details}`);
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
            await sendToChannel(interaction.client, '1527139806797369504', `Staff complaint from <@${interaction.user.id}>: ${details}`);
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
                '1526490481398124614',
                `Manual legacy training result submitted by authorized management (<@${interaction.user.id}>): ${result}`,
            );
            await interaction.reply({ content: 'Manual legacy training result sent.', ephemeral: true });
        }
    }
];
