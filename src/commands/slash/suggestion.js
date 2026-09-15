const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Msg, env, banner } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Submit a suggestion')
        .addStringOption(opt => opt.setName('suggestion').setDescription('Your suggestion').setRequired(true)),

    async execute(interaction) {
        const suggestion = interaction.options.getString('suggestion');
        const channel = interaction.guild.channels.cache.get(process.env.SUGGESTION_CHANNEL_ID);
        if (!channel) return interaction.reply({ content: 'Suggestion channel not configured.', flags: MessageFlags.Ephemeral });

        const payload = v2Msg({
            title: env('SUGGESTION_TITLE', 'New Suggestion'),
            description: suggestion,
            fields: [{ name: 'Suggested By', value: `${interaction.user}` }],
            thumbnail: interaction.user.displayAvatarURL({ dynamic: true }),
            banner: banner('SUGGESTION_BANNER')
        });

        await channel.send(payload);
        return interaction.reply({ content: 'Your suggestion has been submitted!', flags: MessageFlags.Ephemeral });
    }
};
