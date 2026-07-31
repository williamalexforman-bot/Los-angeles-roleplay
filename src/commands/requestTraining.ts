import {
    ActionRowBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';

const TRAINING_DEPARTMENT_ROLE_ID = '1524013351850737835';
const TRAINING_REQUEST_CHANNEL_ID = '1526488294945198150';
const TRAINING_MANAGEMENT_ROLE_ID = '1521593407795888330';

export const requestTrainingCommand = {
    data: new SlashCommandBuilder()
        .setName('request-training')
        .setDescription('Request a training session (Training Department only)'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // Check if the user has the training department role
        const member = interaction.member;
        const roleIds = member && 'roles' in member
            ? (Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()])
            : [];

        if (!roleIds.includes(TRAINING_DEPARTMENT_ROLE_ID) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: 'Only members of the Training Department can request training.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('training:request-modal')
            .setTitle('Training Request')
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('timezone')
                        .setLabel('Your Timezone')
                        .setPlaceholder('e.g. EST, PST, GMT, UTC+2')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(50)
                        .setRequired(true),
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('preferred_time')
                        .setLabel('When do you want to be trained?')
                        .setPlaceholder('e.g. Today at 5 PM EST, or Saturday anytime')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(200)
                        .setRequired(true),
                ),
            );

        await interaction.showModal(modal);
    },
};

export async function handleTrainingModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId !== 'training:request-modal') return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const timezone = interaction.fields.getTextInputValue('timezone').trim();
        const preferredTime = interaction.fields.getTextInputValue('preferred_time').trim();

        const channel = await interaction.client.channels.fetch(TRAINING_REQUEST_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply('The training request channel is unavailable. Please contact an administrator.');
            return true;
        }

        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('🎓 Training Request')
            .setThumbnail(BRAND.logoUrl)
            .setDescription('A training session has been requested by a Training Department member.')
            .addFields(
                { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Timezone', value: timezone, inline: true },
                { name: 'Preferred Time', value: preferredTime, inline: false },
                { name: 'Requested At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
            )
            .setFooter({ text: BRAND.footer })
            .setTimestamp();

        await channel.send({
            content: `<@&${TRAINING_MANAGEMENT_ROLE_ID}> A new training request has been submitted!`,
            embeds: [embed],
            files: [createLogoAttachment()],
            allowedMentions: { roles: [TRAINING_MANAGEMENT_ROLE_ID], parse: [] },
        });

        await interaction.editReply('✅ Your training request has been submitted successfully. Training management has been notified.');
        return true;
    } catch (error) {
        console.error('[TrainingRequest] Modal failed.', error);
        await interaction.editReply('Unable to submit the training request. Please try again later.');
        return true;
    }
}

