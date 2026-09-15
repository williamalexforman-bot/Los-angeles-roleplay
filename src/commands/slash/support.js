const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v2Reply, logo } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('support')
        .setDescription('Get a link to the official support server'),

    async execute(interaction) {
        const payload = v2Reply({
            title: 'Support Server',
            description: 'Need help with the bot, found a bug, or have a suggestion?\nJoin our community support server for real-time assistance!',
            thumbnail: logo()
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Join Support Server')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/zYvqDB5MWB')
        );

        return interaction.reply({ ...payload, components: [row] });
    }
};
