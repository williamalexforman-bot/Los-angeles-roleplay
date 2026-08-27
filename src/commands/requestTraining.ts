import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { logger } from '../utils/logger';

const TRAINING_REQUEST_CHANNEL_ID = '1526488294945198150';
const TRAINING_MANAGEMENT_ROLE_ID = '1521593407795888330';
const TRAINING_REQUEST_BANNER_NAME = 'training-request-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const TRAINING_REQUEST_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', TRAINING_REQUEST_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(TRAINING_REQUEST_BANNER_PATH, { name: TRAINING_REQUEST_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function decisionRow(userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`training:request-approve:${userId}`)
            .setLabel('Approve')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`training:request-deny:${userId}`)
            .setLabel('Deny')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger),
    );
}

function panel(userId: string, timezone: string, preferredTime: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(TRAINING_REQUEST_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🎓 Training Request',
            '',
            `**Requester:** <@${userId}>`,
            `**Timezone:** ${timezone}`,
            `**Preferred Time:** ${preferredTime}`,
            `**Status:** ⏳ Pending`,
            `**Requested:** <t:${Math.floor(Date.now() / 1000)}:F>`,
            '',
            `<@&${TRAINING_MANAGEMENT_ROLE_ID}> — review this request below.`,
        ].join('\n')))
        .addActionRowComponents(decisionRow(userId))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function canReview(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.guild?.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(TRAINING_MANAGEMENT_ROLE_ID)) return true;
    if (member && 'roles' in member && Array.isArray(member.roles) && member.roles.includes(TRAINING_MANAGEMENT_ROLE_ID)) return true;

    const fetched = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(TRAINING_MANAGEMENT_ROLE_ID));
}

function resolvedComponents(interaction: ButtonInteraction, approved: boolean): unknown[] {
    const components = interaction.message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    const visit = (node: Record<string, unknown>): void => {
        if (typeof node.custom_id === 'string' && node.custom_id.startsWith('training:request-')) {
            node.disabled = true;
            if (node.custom_id.includes('approve')) {
                node.label = approved ? `Approved by ${interaction.user.username}`.slice(0, 80) : 'Approve';
                node.style = approved ? ButtonStyle.Success : ButtonStyle.Secondary;
            } else if (node.custom_id.includes('deny')) {
                node.label = approved ? 'Deny' : `Denied by ${interaction.user.username}`.slice(0, 80);
                node.style = approved ? ButtonStyle.Secondary : ButtonStyle.Danger;
            }
        }
        const children = node.components as Array<Record<string, unknown>> | undefined;
        children?.forEach(visit);
    };
    components.forEach(visit);
    return components;
}

export const requestTrainingCommand = {
    data: new SlashCommandBuilder()
        .setName('request-training')
        .setDescription('Request a training session'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
            logger.error(`[TrainingRequest] Destination channel ${TRAINING_REQUEST_CHANNEL_ID} is unavailable or not sendable.`);
            return true;
        }

        const requestMessage = await channel.send({
            content: `<@&${TRAINING_MANAGEMENT_ROLE_ID}> A new training request has been submitted by <@${interaction.user.id}>.`,
            components: [panel(interaction.user.id, timezone, preferredTime)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: [],
                roles: [TRAINING_MANAGEMENT_ROLE_ID],
                users: [interaction.user.id],
            },
        });

        await interaction.editReply(`✅ Your training request has been submitted: ${requestMessage.url}`);
        logger.info(`[TrainingRequest] ${interaction.user.id} submitted request message=${requestMessage.id}.`);
        return true;
    } catch (error) {
        markSlashCommandFailed(interaction as never, error);
        logger.error(`[TrainingRequest] Modal failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Unable to submit the training request. Please try again later.');
        return true;
    }
}

export async function handleTrainingButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('training:request-approve:')
        && !interaction.customId.startsWith('training:request-deny:')) return false;

    if (!(await canReview(interaction))) {
        await interaction.reply({
            content: `Only <@&${TRAINING_MANAGEMENT_ROLE_ID}> or an administrator can review training requests.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    const [, actionPart, userId] = interaction.customId.split(':');
    const approved = actionPart === 'request-approve';
    if (!/^\d{17,20}$/.test(userId || '')) {
        await interaction.reply({ content: 'This training request is invalid or expired.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.update({
        components: resolvedComponents(interaction, approved) as never,
    });

    const requester = await interaction.client.users.fetch(userId).catch(() => null);
    if (requester) {
        await requester.send({
            content: approved
                ? `✅ Your training request in **Los Angeles Roleplay** was approved by ${interaction.user.username}. Training Management should contact you with the session details.`
                : `❌ Your training request in **Los Angeles Roleplay** was denied by ${interaction.user.username}. You may submit another request later if needed.`,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }

    await interaction.followUp({
        content: approved
            ? `✅ <@${userId}>'s training request was approved by <@${interaction.user.id}>.`
            : `❌ <@${userId}>'s training request was denied by <@${interaction.user.id}>.`,
        allowedMentions: { parse: [], users: [userId, interaction.user.id] },
    }).catch(() => undefined);

    logger.info(`[TrainingRequest] request=${interaction.message.id} ${approved ? 'approved' : 'denied'} by ${interaction.user.id} for ${userId}.`);
    return true;
}
