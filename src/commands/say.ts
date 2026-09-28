import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';

export const sayCommand = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message as the bot')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The exact message the bot should send')
                .setRequired(true)
                .setMaxLength(2_000),
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Where to send the message (defaults to this channel)')
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread,
                ),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const message = interaction.options.getString('message', true);
        const selectedChannel = interaction.options.getChannel('channel');
        const target = selectedChannel
            ? await interaction.client.channels.fetch(selectedChannel.id).catch(() => null)
            : interaction.channel;
        if (!target?.isSendable()) {
            markSlashCommandFailed(interaction, new Error('The selected /say destination is not sendable.'));
            await interaction.editReply('Select a text channel where I can send messages.');
            return;
        }

        await target.send({
            content: message,
            allowedMentions: { parse: [] },
        });
        await interaction.editReply(`Message sent successfully in ${target}.`);
    },
};
