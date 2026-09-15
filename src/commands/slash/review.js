const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Msg, env, banner } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('review')
        .setDescription('Submit a review')
        .addUserOption(opt => opt.setName('staff').setDescription('Staff member being reviewed').setRequired(true))
        .addIntegerOption(opt => opt.setName('rating').setDescription('Rating (1-5)').setRequired(true).setMinValue(1).setMaxValue(5))
        .addStringOption(opt => opt.setName('review').setDescription('Your review').setRequired(true)),

    async execute(interaction) {
        const staff = interaction.options.getUser('staff');
        const rating = interaction.options.getInteger('rating');
        const review = interaction.options.getString('review');
        const channel = interaction.guild.channels.cache.get(process.env.REVIEW_CHANNEL_ID);
        if (!channel) return interaction.reply({ content: 'Review channel not configured.', flags: MessageFlags.Ephemeral });

        const filled = env('REVIEW_STAR_FILLED', '[*]');
        const empty = env('REVIEW_STAR_EMPTY', '[ ]');
        const stars = filled.repeat(rating) + empty.repeat(5 - rating);

        const payload = v2Msg({
            title: env('REVIEW_TITLE', 'New Review'),
            description: `${stars}\n\n${review}`,
            fields: [
                { name: 'Staff Member', value: `${staff}` },
                { name: 'Reviewed By', value: `${interaction.user}` }
            ],
            thumbnail: interaction.user.displayAvatarURL({ dynamic: true }),
            banner: banner('REVIEW_BANNER')
        });

        await channel.send(payload);
        return interaction.reply({ content: 'Your review has been submitted!', flags: MessageFlags.Ephemeral });
    }
};
