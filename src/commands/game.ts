import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { sendToChannel } from '../utils/notify';
import { BRAND } from '../config/constants';
import { legacyEmbedToV2Message } from '../utils/embeds';

export const gameCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('teamswitch')
            .setDescription('Submit an authorized manual team-switch report')
            .addUserOption(opt => opt.setName('user').setDescription('User who switched teams').setRequired(true))
            .addStringOption(opt => opt.setName('from').setDescription('Team switched from').setRequired(true))
            .addStringOption(opt => opt.setName('to').setDescription('Team switched to').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const from = interaction.options.getString('from') || 'unknown';
            const to = interaction.options.getString('to') || 'unknown';

            const embed = new EmbedBuilder()
                .setTitle('Manual ER:LC Team Change Report')
                .setColor(BRAND.color)
                .setThumbnail(BRAND.logoUrl)
                .setDescription('This entry was submitted manually by authorized management; it was not detected by the ER:LC API.')
                .addFields(
                    { name: 'Submitted By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'User', value: `<@${user?.id}>`, inline: true },
                    { name: 'From', value: from, inline: true },
                    { name: 'To', value: to, inline: true }
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            await sendToChannel(interaction.client, '1528917232153923635', legacyEmbedToV2Message(embed, {
                allowedMentions: { parse: [] },
            }));
            await interaction.reply({ content: `Reported team switch for ${user?.username}.`, ephemeral: true });
        },
    },
];
