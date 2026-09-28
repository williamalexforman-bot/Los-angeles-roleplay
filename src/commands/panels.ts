import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { bannerFiles, bannerUrl, underbannerEmbed } from '../utils/bannerAssets';

function linkButton(label: string, guildId: string, channelId: string): ButtonBuilder | null {
    if (!channelId) return null;
    return new ButtonBuilder()
        .setLabel(label)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
}

const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the LARP server dashboard'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('California State Roleplay Dashboard')
            .setDescription('Use this dashboard to quickly access important community resources and support.')
            .setImage(bannerUrl('dashboard'))
            .addFields(
                { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            )
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        const buttons = [
            linkButton('Regulations', guild.id, CHANNEL_IDS.rules),
            linkButton('Support', guild.id, CHANNEL_IDS.ticketPanel),
        ].filter((button): button is ButtonBuilder => Boolean(button));
        await interaction.reply({
            embeds: [embed, underbannerEmbed()],
            components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
            files: bannerFiles('dashboard'),
            allowedMentions: { parse: [] },
        });
    },
};

const regulationsCommand = {
    data: new SlashCommandBuilder()
        .setName('regulations')
        .setDescription('Post the community regulations'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('Community Regulations')
            .setDescription([
                '**Respect** — Treat every community member and staff member respectfully.',
                '**Appropriate Content** — Keep all messages, media, and profiles suitable for a 13+ audience.',
                '**No Spam or Advertising** — Do not flood channels or advertise without permission.',
                '**Roleplay Conduct** — Follow server rules, ER:LC guidelines, and staff directions during sessions.',
                '**Common Sense** — Not every situation can be listed. Use good judgment and do not disrupt the community.',
            ].join('\n\n'))
            .setImage(bannerUrl('regulations'))
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        await interaction.reply({
            embeds: [embed, underbannerEmbed()],
            files: bannerFiles('regulations'),
            allowedMentions: { parse: [] },
        });
    },
};

export const panelCommands = [dashboardCommand, regulationsCommand];
