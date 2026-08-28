import { resolve } from 'path';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type Interaction,
    type ModalSubmitInteraction,
    type StringSelectMenuInteraction,
    type TextChannel,
} from 'discord.js';
import { SUPPORT_FAQ, TICKET_TERMS } from '../commands/supportContent';
import { logger } from '../utils/logger';

const SUPPORT_ROLE_ID = '1523122697746382868';
const INTERNAL_ROLE_ID = '1521593407816990811';
const MANAGEMENT_ROLE_ID = '1523122912201277590';
const HIGH_RANK_ROLE_ID = '1527845170748326021';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

const CATEGORIES = {
    general: { label: 'General Support', parentId: '1526254341646712883', roleId: SUPPORT_ROLE_ID, prefix: 'gen' },
    internal: { label: 'Internal Affairs Support', parentId: '1526254402426503320', roleId: INTERNAL_ROLE_ID, prefix: 'ia' },
    management: { label: 'Management Support', parentId: '1526254462128099479', roleId: MANAGEMENT_ROLE_ID, prefix: 'mgmt' },
    highrank: { label: 'Directorship / Ownership', parentId: '1526254518570844231', roleId: HIGH_RANK_ROLE_ID, prefix: 'hr' },
} as const;

type TicketType = keyof typeof CATEGORIES;

function isTicketType(value: string): value is TicketType {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

function modalInput(id: string, label: string, style: TextInputStyle, required = true): ActionRowBuilder<TextInputBuilder> {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(style)
            .setRequired(required)
            .setMaxLength(style === TextInputStyle.Short ? 100 : 1000),
    );
}

function ticketModal(type: TicketType): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`direct-ticket:create:${type}`)
        .setTitle(`${CATEGORIES[type].label} Ticket`.slice(0, 45));

    if (type === 'internal') {
        return modal.addComponents(
            modalInput('reported_user', 'User you are reporting', TextInputStyle.Short),
            modalInput('reason', 'Reason for report', TextInputStyle.Paragraph),
            modalInput('proof', 'Do you have proof?', TextInputStyle.Paragraph),
            modalInput('anything_else', 'Anything else?', TextInputStyle.Paragraph, false),
        );
    }

    return modal.addComponents(
        modalInput('reason', 'Reason for opening ticket', TextInputStyle.Paragraph),
    );
}

function reviewRow(type: TicketType, userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`direct-ticket:continue:${type}:${userId}`)
            .setLabel('Continue to Ticket Form')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Primary),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function banner(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function reviewPanel(type: TicketType, userId: string): ContainerBuilder {
    const config = CATEGORIES[type];
    const faqText = SUPPORT_FAQ.length > 1_700 ? `${SUPPORT_FAQ.slice(0, 1_699)}…` : SUPPORT_FAQ;
    const tosText = TICKET_TERMS.length > 1_700 ? `${TICKET_TERMS.slice(0, 1_699)}…` : TICKET_TERMS;

    return new ContainerBuilder()
        .setAccentColor(0x247bf1)
        .addMediaGalleryComponents(banner(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                `## 🎫 ${config.label}`,
                'Before opening your ticket, please review the information below.',
                '',
                faqText,
            ].join('\n')),
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                tosText,
                '',
                '**By continuing, you confirm that you have read the FAQ and Ticket Terms of Service.**',
            ].join('\n')),
        )
        .addActionRowComponents(reviewRow(type, userId))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(banner(UNDERBANNER_NAME));
}

async function showReview(interaction: StringSelectMenuInteraction, type: TicketType): Promise<void> {
    const startedAt = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info(`[DirectTickets] Deferred ${type} ticket select for ${interaction.user.id} in ${Date.now() - startedAt}ms.`);

    await interaction.editReply({
        components: [reviewPanel(type, interaction.user.id)],
        files: [
            { attachment: ASSISTANCE_BANNER_PATH, name: ASSISTANCE_BANNER_NAME },
            { attachment: UNDERBANNER_PATH, name: UNDERBANNER_NAME },
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    logger.info(`[DirectTickets] Displayed V2 FAQ/TOS panel for ${type} to ${interaction.user.id} in ${Date.now() - startedAt}ms total.`);
}

function safeChannelPart(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'support';
}

function encodeMetadata(ownerId: string, type: TicketType, panelMessageId?: string): string {
    const payload = {
        ownerId,
        type,
        createdAt: new Date().toISOString(),
        ...(panelMessageId ? { panelMessageId } : {}),
    };
    return `larp-ticket:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function actionRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:escalate').setLabel('Escalate').setStyle(ButtonStyle.Secondary),
    );
}

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the server.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const config = CATEGORIES[type];
    const reason = interaction.fields.getTextInputValue('reason');

    // Do not abort a valid ticket because one configured category/role was
    // renamed, deleted, or temporarily unavailable. Internal Affairs working
    // while other types failed showed these hard validations were too brittle.
    const configuredParent = guild.channels.cache.get(config.parentId)
        || await guild.channels.fetch(config.parentId).catch(() => null);
    const parentId = configuredParent?.type === ChannelType.GuildCategory ? configuredParent.id : undefined;

    const supportRole = guild.roles.cache.get(SUPPORT_ROLE_ID)
        || await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
    const categoryRole = guild.roles.cache.get(config.roleId)
        || await guild.roles.fetch(config.roleId).catch(() => null);

    if (!parentId) {
        logger.warn(`[DirectTickets] Parent ${config.parentId} for ${type} is unavailable; creating the ticket without a parent instead of failing.`);
    }
    if (!categoryRole) {
        logger.warn(`[DirectTickets] Role ${config.roleId} for ${type} is unavailable; falling back to General Support access.`);
    }
    if (!supportRole) {
        logger.warn(`[DirectTickets] General Support role ${SUPPORT_ROLE_ID} is unavailable; opener and bot access will still be created.`);
    }

    const staffRoleIds = Array.from(new Set([
        supportRole?.id,
        categoryRole?.id,
    ].filter((value): value is string => Boolean(value))));

    const permissionOverwrites: Array<{
        id: string;
        allow?: bigint[];
        deny?: bigint[];
    }> = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
        ...staffRoleIds.map(id => ({
            id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        })),
        {
            id: interaction.client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
    ];

    let channel: TextChannel | null = null;
    try {
        channel = await guild.channels.create({
            name: `${config.prefix}-${safeChannelPart(reason)}-${interaction.user.id.slice(-4)}`.slice(0, 40),
            type: ChannelType.GuildText,
            ...(parentId ? { parent: parentId } : {}),
            topic: encodeMetadata(interaction.user.id, type),
            permissionOverwrites,
            reason: `${config.label} ticket opened by ${interaction.user.tag}`,
        });

        const extra = type === 'internal'
            ? [
                `**User Reported:** ${interaction.fields.getTextInputValue('reported_user')}`,
                `**Proof:** ${interaction.fields.getTextInputValue('proof')}`,
                `**Anything Else:** ${interaction.fields.getTextInputValue('anything_else') || 'Nothing else provided.'}`,
            ]
            : [];

        const pingRoleId = categoryRole?.id || supportRole?.id;
        const panel = await channel.send({
            content: [
                pingRoleId
                    ? `<@${interaction.user.id}> | <@&${pingRoleId}>`
                    : `<@${interaction.user.id}>`,
                `## 🎫 ${config.label} Ticket`,
                `**Opened By:** <@${interaction.user.id}>`,
                '**Reason:**',
                reason.slice(0, 1500),
                ...extra,
                '',
                'A staff member will assist you shortly.',
            ].join('\n'),
            components: [actionRow()],
            allowedMentions: {
                parse: [],
                users: [interaction.user.id],
                roles: pingRoleId ? [pingRoleId] : [],
            },
        });

        await channel.setTopic(encodeMetadata(interaction.user.id, type, panel.id), 'Ticket panel linked.').catch(error => {
            logger.warn(`[DirectTickets] Ticket ${channel?.id} was created but topic linking failed: ${error instanceof Error ? error.message : String(error)}`);
        });

        await interaction.editReply(`✅ Your ${config.label} ticket has been created: <#${channel.id}>`);
        logger.info(`[DirectTickets] Created ${type} ticket ${channel.id} for ${interaction.user.id}; parent=${parentId || 'none'} role=${pingRoleId || 'none'}.`);
    } catch (error) {
        if (channel) await channel.delete('Ticket setup failed.').catch(() => undefined);
        logger.error(`[DirectTickets] Ticket creation failed for ${type}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply(`Unable to create your **${config.label}** ticket. Please contact an administrator.`).catch(() => undefined);
    }
}

/** Handles all FAQ/TOS ticket opening from the single StableRouter. */
export async function handleDirectTicketInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create-select') {
        const typeValue = interaction.values[0] || '';
        if (!isTicketType(typeValue)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await showReview(interaction, typeValue);
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('direct-ticket:continue:')) {
        const [, , typeValue, ownerId] = interaction.customId.split(':');
        if (!isTicketType(typeValue)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'This ticket form belongs to another user.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(ticketModal(typeValue));
        logger.info(`[DirectTickets] Opened ${typeValue} ticket form for ${interaction.user.id} after FAQ/TOS review.`);
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('direct-ticket:create:')) {
        const typeValue = interaction.customId.split(':')[2] || '';
        if (!isTicketType(typeValue)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await createTicket(interaction, typeValue);
        return true;
    }

    return false;
}
