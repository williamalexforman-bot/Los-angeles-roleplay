import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    Client,
    ContainerBuilder,
    Events,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type GuildMember,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const MANAGEMENT_CATEGORY_ID = '1526254462128099479';
const MANAGEMENT_ROLE_ID = '1521593407741362259';
const HIGH_RANK_ROLE_ID = '1521593407804280970';
const RETIREMENT_REVIEW_CHANNEL_ID = '1542340842390290492';
const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const registeredClients = new WeakSet<Client>();

type TicketMetadata = {
    ownerId: string;
    type: 'general' | 'internal' | 'management' | 'highrank';
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
    retirementPrompted?: boolean;
    retirementSubmitted?: boolean;
    retirementReviewMessageId?: string;
};

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
        return parsed?.ownerId && parsed?.type ? parsed : null;
    } catch {
        return null;
    }
}

function encodeMetadata(metadata: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
}

function isRetirementTicket(channel: TextChannel): boolean {
    const text = channel.name.replace(/-/g, ' ');
    return /\b(retir(?:e|ement|ing)|resign(?:ation|ing)?|step(?:ping)? down|leav(?:e|ing) staff)\b/iu.test(text);
}

function memberHasRole(member: ButtonInteraction['member'], roleId: string): boolean {
    if (!member) return false;
    const roles = (member as GuildMember).roles;
    if (roles && 'cache' in roles) return roles.cache.has(roleId);
    return Array.isArray((member as { roles?: string[] }).roles)
        && (member as { roles: string[] }).roles.includes(roleId);
}

function canReview(interaction: ButtonInteraction): boolean {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
        || memberHasRole(interaction.member, MANAGEMENT_ROLE_ID)
        || memberHasRole(interaction.member, HIGH_RANK_ROLE_ID);
}

function retirementPrompt(ownerId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `<@${ownerId}>`,
            '## 🏛️ Retirement Request',
            'Because this ticket is about retiring, it has been routed to **Management Support**.',
            '',
            'Press **Fill Out Retirement Request** below. Your completed request will be sent privately to management for approval or denial.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`retirement:form:${ownerId}`)
                .setLabel('Fill Out Retirement Request')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Primary),
        ))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function retirementModal(ownerId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`retirement:submit:${ownerId}`)
        .setTitle('Retirement Request')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('username')
                    .setLabel('Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('role')
                    .setLabel('Role')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Why do you want to retire?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1000),
            ),
        );
}

function decisionRow(ticketChannelId: string, ownerId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`retirement:approve:${ticketChannelId}:${ownerId}`)
            .setLabel('Approve')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`retirement:deny:${ticketChannelId}:${ownerId}`)
            .setLabel('Deny')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
    );
}

function resultPanel(ownerId: string, approved: boolean, reviewerId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `<@${ownerId}>`,
            approved ? '## ✅ Retirement Request Approved' : '## ❌ Retirement Request Denied',
            approved
                ? `Your retirement request was **approved** by <@${reviewerId}>. Management will handle any remaining staff changes.`
                : `Your retirement request was **denied** by <@${reviewerId}>. Please speak with management in this ticket if you have questions.`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function prepareRetirementTicket(channel: TextChannel): Promise<void> {
    // Let the main ticket creator finish linking its panel/topic first so our
    // management routing cannot be overwritten by the creation transaction.
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1800));

    let metadata = decodeMetadata(channel.topic);
    if (!metadata || metadata.retirementPrompted || !isRetirementTicket(channel)) return;

    try {
        if (channel.parentId !== MANAGEMENT_CATEGORY_ID) {
            await channel.setParent(MANAGEMENT_CATEGORY_ID, {
                lockPermissions: false,
                reason: 'Retirement requests are handled by Management Support.',
            });
        }
        await channel.permissionOverwrites.edit(MANAGEMENT_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
        }, { reason: 'Management access for retirement request' });

        metadata = decodeMetadata(channel.topic) || metadata;
        metadata.type = 'management';
        metadata.retirementPrompted = true;
        await channel.setTopic(encodeMetadata(metadata), 'Retirement ticket routed to Management Support');

        await channel.send({
            components: [retirementPrompt(metadata.ownerId)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [metadata.ownerId], roles: [MANAGEMENT_ROLE_ID] },
        });
        await channel.send({
            content: `<@&${MANAGEMENT_ROLE_ID}> This retirement ticket was automatically routed to Management Support.`,
            allowedMentions: { parse: [], roles: [MANAGEMENT_ROLE_ID] },
        });
    } catch (error) {
        logger.warn(`[Retirement] Could not prepare ticket ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function submitRetirement(interaction: ModalSubmitInteraction, ownerId: string): Promise<void> {
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: 'Only the ticket opener can submit this retirement request.', flags: MessageFlags.Ephemeral });
        return;
    }
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'This retirement form must be submitted from its ticket.', flags: MessageFlags.Ephemeral });
        return;
    }
    const metadata = decodeMetadata(channel.topic);
    if (!metadata || metadata.ownerId !== ownerId) {
        await interaction.reply({ content: 'This is not the retirement ticket connected to your request.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (metadata.retirementSubmitted) {
        await interaction.reply({ content: 'A retirement request has already been submitted from this ticket.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reviewChannel = await interaction.client.channels.fetch(RETIREMENT_REVIEW_CHANNEL_ID).catch(() => null);
    if (!reviewChannel?.isSendable()) {
        await interaction.editReply('I could not reach the management retirement-review channel. Please tell management.');
        return;
    }

    const username = interaction.fields.getTextInputValue('username').trim();
    const role = interaction.fields.getTextInputValue('role').trim();
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const claimantPing = metadata.claimedBy ? `<@${metadata.claimedBy}>\n` : '';
    const reviewMessage = await reviewChannel.send({
        content: [
            claimantPing,
            '## 🏛️ Retirement Request',
            `**Requester:** <@${ownerId}>`,
            `**Ticket:** <#${channel.id}>`,
            `**Username:** ${username}`,
            `**Role:** ${role}`,
            '**Why do you want to retire?**',
            reason,
            '',
            metadata.claimedBy
                ? `**Ticket Claimed By:** <@${metadata.claimedBy}>`
                : '**Ticket Claimed By:** Unclaimed — the future claimant will be pinged here automatically.',
        ].filter(Boolean).join('\n'),
        components: [decisionRow(channel.id, ownerId)],
        allowedMentions: {
            parse: [],
            users: metadata.claimedBy ? [metadata.claimedBy] : [],
        },
    });

    metadata.retirementSubmitted = true;
    metadata.retirementReviewMessageId = reviewMessage.id;
    await channel.setTopic(encodeMetadata(metadata), 'Retirement request submitted for management review');
    await interaction.editReply('✅ Your retirement request was submitted to management for review.');
}

async function notifyClaimant(interaction: ButtonInteraction): Promise<void> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 750));
    const metadata = decodeMetadata(channel.topic);
    if (!metadata?.retirementReviewMessageId || !metadata.retirementSubmitted) return;

    const reviewChannel = await interaction.client.channels.fetch(RETIREMENT_REVIEW_CHANNEL_ID).catch(() => null);
    if (!reviewChannel?.isSendable() || !('messages' in reviewChannel)) return;
    const reviewMessage = await reviewChannel.messages.fetch(metadata.retirementReviewMessageId).catch(() => null);
    if (!reviewMessage) return;

    await reviewChannel.send({
        content: `<@${interaction.user.id}> You claimed <#${channel.id}>. Its retirement request is waiting for your review: ${reviewMessage.url}`,
        allowedMentions: { parse: [], users: [interaction.user.id] },
    }).catch(() => undefined);
}

async function decideRetirement(interaction: ButtonInteraction, approved: boolean, ticketChannelId: string, ownerId: string): Promise<void> {
    if (!canReview(interaction)) {
        await interaction.reply({ content: 'Only Management/Directorship staff can approve or deny retirement requests.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ticket = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
    if (!ticket || ticket.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'The linked retirement ticket no longer exists.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.update({
        content: `${interaction.message.content}\n\n**Decision:** ${approved ? '✅ APPROVED' : '❌ DENIED'} by <@${interaction.user.id}>`,
        components: [decisionRow(ticketChannelId, ownerId, true)],
        allowedMentions: { parse: [] },
    });

    const requester = await interaction.client.users.fetch(ownerId).catch(() => null);
    if (requester) {
        await requester.send(
            approved
                ? `✅ Your Los Angeles Roleplay retirement request has been approved by ${interaction.user.username}.`
                : `❌ Your Los Angeles Roleplay retirement request has been denied by ${interaction.user.username}. Please check your ticket for more information.`,
        ).catch(() => undefined);
    }

    await ticket.send({
        components: [resultPanel(ownerId, approved, interaction.user.id)],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [ownerId] },
    }).catch(error => {
        logger.warn(`[Retirement] Could not post decision in ticket ${ticketChannelId}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

export function registerRetirementTicketWorkflow(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.ChannelCreate, channel => {
        if (channel.type !== ChannelType.GuildText) return;
        void prepareRetirementTicket(channel).catch(error => {
            logger.warn(`[Retirement] New-ticket routing failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });

    client.on(Events.InteractionCreate, interaction => {
        if (interaction.isButton()) {
            if (interaction.customId === 'ticket:claim') {
                void notifyClaimant(interaction).catch(() => undefined);
                return;
            }
            if (interaction.customId.startsWith('retirement:form:')) {
                const ownerId = interaction.customId.split(':')[2] || '';
                if (interaction.user.id !== ownerId) {
                    void interaction.reply({ content: 'Only the ticket opener can fill out this retirement request.', flags: MessageFlags.Ephemeral });
                    return;
                }
                void interaction.showModal(retirementModal(ownerId));
                return;
            }
            if (interaction.customId.startsWith('retirement:approve:') || interaction.customId.startsWith('retirement:deny:')) {
                const [,, ticketChannelId, ownerId] = interaction.customId.split(':');
                const approved = interaction.customId.startsWith('retirement:approve:');
                void decideRetirement(interaction, approved, ticketChannelId, ownerId).catch(error => {
                    logger.warn(`[Retirement] Decision failed: ${error instanceof Error ? error.message : String(error)}`);
                });
            }
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('retirement:submit:')) {
            const ownerId = interaction.customId.split(':')[2] || '';
            void submitRetirement(interaction, ownerId).catch(error => {
                logger.warn(`[Retirement] Submission failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    });

    logger.info('[Retirement] Management-only retirement ticket workflow enabled.');
}
