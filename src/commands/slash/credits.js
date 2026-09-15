const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v2Reply, env, logo } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('credits')
        .setDescription('View the creators and contributors of this bot'),

    async execute(interaction) {
        const payload = v2Reply({
            title: 'Bot Credits',
            description: 'This bot is a professional, open-source utility for ER:LC Private Servers.',
            fields: [
                { name: 'Developers', value: 'Developed and maintained with ❤️ by **SEJED-DEV**.' },
                { name: 'License', value: 'Distributed under the **Custom MIT License**. Available for free use with attribution.' },
                { name: 'Support', value: 'Need help? Join our support community!' }
            ],
            thumbnail: logo()
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('GitHub Repository')
                .setStyle(ButtonStyle.Link)
                .setURL('https://github.com/SEJED-DEV/ERLC-UTILITY-BOT'),
            new ButtonBuilder()
                .setLabel('Support Server')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/zYvqDB5MWB')
        );

        return interaction.reply({ ...payload, components: [row] });
    }
};
