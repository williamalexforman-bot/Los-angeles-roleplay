import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Events,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
    type Client,
    type ModalSubmitInteraction,
    type StringSelectMenuInteraction,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();

const SUPPORT_ROLE_ID = '1523122697746382868';
const INTERNAL_ROLE_ID = '1521593407816990811';
const MANAGEMENT_ROLE_ID = '1523122912201277590';
const HIGH_RANK_ROLE_ID = '1527845170748326021';

const CATEGORIES = {
    general: { label: 'General Support', parentId: '1526254341646712883', roleId: SUPPORT_ROLE_ID, prefix: 'gen' },
    internal: { label: 'Internal Affairs Support', parentId: '1526254402426503320', roleId: INTERNAL_ROLE_ID, prefix: 'ia' },
    management: { label: 'Management Support', parentId: '1526254462128099479', roleId: MANAGEMENT_ROLE_ID, prefix: 'mgmt' },
    highrank: { label: 'Directorship / Ownership', parentId: '1526254518570844231', roleId: HIGH_RANK_ROLE_ID, prefix: 'hr' },
} as const;

type TicketType = keyof typeof CATEGORIES;

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

async function openModal(interaction: StringSelectMenuInteraction, type: TicketType): Promise<void> {
    try {
        await interaction.showModal(ticketModal(type));
        logger.info(`[DirectTickets] Opened ${type} ticket modal for ${interaction.user.id}.`);
    } catch (error) {
        logger.error(`[DirectTickets] Could not open ${type} modal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
}

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the server.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

    const config = CATEGORIES[type];
    const reason = interaction.fields.getTextInputValue('reason');
    const category = guild.channels.cache.get(config.parentId) || await guild.channels.fetch(config.parentId).catch(() => null);
    const supportRole = guild.roles.cache.get(SUPPORT_ROLE_ID) || await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
    const categoryRole = guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply(`Ticket category is missing or invalid for **${config.label}**.`).catch(() => undefined);
        logger.error(`[DirectTickets] Invalid parent category ${config.parentId} for ${type}.`);
        return;
    }
    if (!supportRole) {
        await interaction.editReply('The General Support role is missing.').catch(() => undefined);
        logger.error(`[DirectTickets] Missing support role ${SUPPORT_ROLE_ID}.`);
        return;
    }
    if (!categoryRole) {
        await interaction.editReply(`The support role for **${config.label}** is missing.`).catch(() => undefined);
        logger.error(`[DirectTickets] Missing category role ${config.roleId} for ${type}.`);
        return;
    }

    let channel: TextChannel | null = null;
    try {
        channel = await guild.channels.create({
            name: `${config.prefix}-${safeChannelPart(reason)}-${interaction.user.id.slice(-4)}`.slice(0, 40),
            type: ChannelType.GuildText,
            parent: config.parentId,
            topic: encodeMetadata(interaction.user.id, type),
            permissionOverwrites: [
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
                {
                    id: SUPPORT_ROLE_ID,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                    ],
                },
                ...(config.roleId === SUPPORT_ROLE_ID ? [] : [{
                    id: config.roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                    ],
                }]),
                {
                    id: interaction.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages,
                    ],
                },
            ],
            reason: `${config.label} ticket opened by ${interaction.user.tag}`,
        });

        const extra = type === 'internal'
            ? [
                `**User Reported:** ${interaction.fields.getTextInputValue('reported_user')}`,
                `**Proof:** ${interaction.fields.getTextInputValue('proof')}`,
                `**Anything Else:** ${interaction.fields.getTextInputValue('anything_else') || 'Nothing else provided.'}`,
            ]
            : [];

        const panel = await channel.send({
            content: [
                `<@${interaction.user.id}> | <@&${config.roleId}>`,
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
                roles: [config.roleId],
            },
        });

        await channel.setTopic(encodeMetadata(interaction.user.id, type, panel.id), 'Ticket panel linked.');
        await interaction.editReply(`✅ Your ${config.label} ticket has been created: <#${channel.id}>`);
        logger.info(`[DirectTickets] Created ${type} ticket ${channel.id} for ${interaction.user.id}.`);
    } catch (error) {
        if (channel) await channel.delete('Ticket setup failed.').catch(() => undefined);
        logger.error(`[DirectTickets] Ticket creation failed for ${type}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Unable to create your ticket. Please contact an administrator.').catch(() => undefined);
    }
}

export function registerDirectTicketOpen(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.prependListener(Events.InteractionCreate, interaction => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create-select') {
            const type = interaction.values[0] as TicketType;
            if (!(type in CATEGORIES)) return;

            // Hide this interaction from the legacy StableRouter synchronously.
            // EventEmitter does not await async listeners, so this mutation must
            // happen before the first await in our direct handler.
            (interaction as unknown as { customId: string }).customId = 'direct-ticket:handled-select';
            void openModal(interaction, type);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('direct-ticket:create:')) {
            const type = interaction.customId.split(':')[2] as TicketType;
            if (!(type in CATEGORIES)) return;
            (interaction as unknown as { customId: string }).customId = 'direct-ticket:handled-modal';
            void createTicket(interaction, type);
        }
    });

    logger.info('[DirectTickets] Direct ticket opening flow enabled for General, Internal Affairs, Management, and High Rank.');
}
