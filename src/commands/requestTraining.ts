import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { markSlashCommandFailed } from '../utils/commandAudit';

const TRAINING_DEPARTMENT_ROLE_ID = '1524013351850737835';
const TRAINING_REQUEST_CHANNEL_ID = '1526488294945198150';
const TRAINING_MANAGEMENT_ROLE_ID = '1521593407795888330';
const TRAINING_REQUEST_BANNER_NAME = 'training-request-banner.webp';
const UNDERBANNER_NAME = 'underbanner.webp';
const TRAINING_REQUEST_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', TRAINING_REQUEST_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}
function separator(): SeparatorBuilder { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function artwork(): AttachmentBuilder[] {
    return [new AttachmentBuilder(TRAINING_REQUEST_BANNER_PATH, { name: TRAINING_REQUEST_BANNER_NAME }), new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME })];
}
function panel(userId: string, timezone: string, preferredTime: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(TRAINING_REQUEST_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🎓 Training Request',
            `> **Requested By:** <@${userId}>`,
            `> **Timezone:** \`${timezone}\``,
            `> **Preferred Time:** ${preferredTime}`,
            `> **Requested At:** <t:${Math.floor(Date.now() / 1000)}:F>`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export const requestTrainingCommand = {
    data: new SlashCommandBuilder().setName('request-training').setDescription('Request a training session (Training Department only)'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const member = interaction.member;
        const roleIds = member && 'roles' in member ? (Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()]) : [];
        if (!roleIds.includes(TRAINING_DEPARTMENT_ROLE_ID) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'Only members of the Training Department can request training.', flags: MessageFlags.Ephemeral });
            return;
        }
        const modal = new ModalBuilder().setCustomId('training:request-modal').setTitle('Training Request').addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('timezone').setLabel('Your Timezone').setPlaceholder('e.g. EST, PST, GMT, UTC+2').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('preferred_time').setLabel('When do you want to be trained?').setPlaceholder('e.g. Today at 5 PM EST, or Saturday anytime').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
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
        if (!channel?.isSendable()) { await interaction.editReply('The training request channel is unavailable. Please contact an administrator.'); return true; }
        await channel.send({
            content: `<@&${TRAINING_MANAGEMENT_ROLE_ID}> A new training request has been submitted!`,
            components: [panel(interaction.user.id, timezone, preferredTime)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { roles: [TRAINING_MANAGEMENT_ROLE_ID], parse: [] },
        });
        await interaction.editReply('✅ Your training request has been submitted successfully. Training management has been notified.');
        return true;
    } catch (error) {
        markSlashCommandFailed(interaction as never, error);
        console.error('[TrainingRequest] Modal failed.', error);
        await interaction.editReply('Unable to submit the training request. Please try again later.');
        return true;
    }
}
