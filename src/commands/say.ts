import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';

interface SayDestination {
    isSendable(): boolean;
    send(payload: { content: string; allowedMentions: { parse: never[] } }): Promise<unknown>;
    toString(): string;
}

function isSayDestination(channel: unknown): channel is SayDestination {
    if (!channel || typeof channel !== 'object') return false;
    const candidate = channel as Partial<SayDestination>;
    return typeof candidate.isSendable === 'function'
        && candidate.isSendable()
        && typeof candidate.send === 'function';
}

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
        const message = interaction.options.getString('message', true);
        const selectedChannel = interaction.options.getChannel('channel');
        const target = selectedChannel || interaction.channel;

        if (!isSayDestination(target)) {
            markSlashCommandFailed(interaction, new Error('The selected /say destination is not sendable.'));
            await interaction.reply({
                content: 'Select a text channel where I can send messages.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await target.send({
                content: message,
                allowedMentions: { parse: [] },
            });
            await interaction.editReply(`✅ Message sent successfully in ${target}.`);
        } catch (error) {
            markSlashCommandFailed(interaction, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    },
};
