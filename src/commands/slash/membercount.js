const { SlashCommandBuilder } = require('discord.js');
const { v2Reply, env, tpl } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('membercount')
        .setDescription('View the server member count'),

    async execute(interaction) {
        const guild = interaction.guild;

        return interaction.reply(v2Reply({
            title: tpl(env('MEMBERCOUNT_TITLE', '{server} -- Member Count'), { server: guild.name }),
            fields: [
                { name: 'Total Members', value: `${guild.memberCount}` },
                { name: 'Humans', value: `${guild.members.cache.filter(m => !m.user.bot).size}` },
                { name: 'Bots', value: `${guild.members.cache.filter(m => m.user.bot).size}` }
            ],
            thumbnail: guild.iconURL({ dynamic: true })
        }));
    }
};
