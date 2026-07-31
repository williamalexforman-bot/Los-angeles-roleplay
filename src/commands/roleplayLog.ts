import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    MessageFlags,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';

const ROLEPLAY_LOG_CHANNEL_ID = '1532141552108048514';

export const roleplayLogCommand = {
    data: new SlashCommandBuilder()
        .setName('roleplay-log')
        .setDescription('Log a roleplay session')
        .addStringOption(option =>
            option
                .setName('usernames')
                .setDescription('Username(s) involved in the roleplay')
                .setRequired(true)
                .setMaxLength(500),
        )
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type of roleplay (e.g. Patrol, Traffic Stop, Investigation, etc.)')
                .setRequired(true)
                .setMaxLength(200),
        )
        .addStringOption(option =>
            option
                .setName('location')
                .setDescription('Location of the roleplay')
                .setRequired(true)
                .setMaxLength(500),
        )
        .addStringOption(option =>
            option
                .setName('expires')
                .setDescription('When does the permission expire?')
                .setRequired(true)
                .setMaxLength(200),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const usernames = interaction.options.getString('usernames', true);
            const type = interaction.options.getString('type', true);
            const location = interaction.options.getString('location', true);
            const expires = interaction.options.getString('expires', true);

            const channel = await interaction.client.channels.fetch(ROLEPLAY_LOG_CHANNEL_ID).catch(() => null);
            if (!channel?.isSendable()) {
                await interaction.editReply('The roleplay log channel is unavailable. Please contact an administrator.');
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('📜 Roleplay Log')
                .setThumbnail(BRAND.logoUrl)
                .addFields(
                    { name: 'Username(s)', value: usernames, inline: false },
                    { name: 'Type of Roleplay', value: type, inline: true },
                    { name: 'Location', value: location, inline: true },
                    { name: 'Permission Expires At', value: expires, inline: false },
                    { name: 'Log Created By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Log Created At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            await channel.send({
                embeds: [embed],
                files: [createLogoAttachment()],
                allowedMentions: { parse: [] },
            });

            await interaction.editReply('✅ Roleplay log has been posted successfully.');
        } catch (error) {
            console.error('[RoleplayLog] Failed to post log.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to post the roleplay log right now. Please try again later.');
        }
    },
};

