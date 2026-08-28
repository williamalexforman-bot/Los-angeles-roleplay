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

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function reviewButton(type: TicketType, userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`reliable-ticket:continue:${type}:${userId}`)
            .setLabel('Continue to Ticket Form')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Primary),
    );
}

function reviewPanel(type: TicketType, userId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x247bf1)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 🎫 ${CATEGORIES[type].label}`,
            'Before opening your ticket, review the FAQ and Ticket Terms of Service below.',
            '',
            SUPPORT_FAQ,
        ].join('\n').slice(0, 3_800)))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            TICKET_TERMS,
            '',
            '**Press Continue to Ticket Form when you are ready.**',
        ].join('\n').slice(0, 3_800)))
        .addActionRowComponents(reviewButton(type, userId))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function input(id: string, label: string, style: TextInputStyle, required = true): ActionRowBuilder<TextInputBuilder> {
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
        .setCustomId(`reliable-ticket:create:${type}`)
        .setTitle(`${CATEGORIES[type].label} Ticket`.slice(0, 45));

    if (type === 'internal') {
        return modal.addComponents(
            input('reported_user', 'User you are reporting', TextInputStyle.Short),
            input('reason', 'Reason for report', TextInputStyle.Paragraph),
            input('proof', 'Do you have proof?', TextInputStyle.Paragraph),
            input('details', 'Anything else?', TextInputStyle.Paragraph, false),
        );
    }

    return modal.addComponents(
        input('reason', 'Reason for opening ticket', TextInputStyle.Paragraph),
        input('details', 'Additional details', TextInputStyle.Paragraph, false),
    );
}

function safeName(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'support';
}

function topic(ownerId: string, type: TicketType, panelMessageId?: string): string {
    return `larp-ticket:${Buffer.from(JSON.stringify({
        ownerId,
        type,
        createdAt: new Date().toISOString(),
        ...(panelMessageId ? { panelMessageId } : {}),
    }), 'utf8').toString('base64url')}`;
}

function ticketButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:escalate').setLabel('Escalate').setStyle(ButtonStyle.Secondary),
    );
}

async function showReview(interaction: StringSelectMenuInteraction, type: TicketType): Promise<void> {
    const started = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info(`[ReliableTickets] ACK select type=${type} user=${interaction.user.id} ms=${Date.now() - started}`);

    await interaction.editReply({
        components: [reviewPanel(type, interaction.user.id)],
        files: [
            { attachment: ASSISTANCE_BANNER_PATH, name: ASSISTANCE_BANNER_NAME },
            { attachment: UNDERBANNER_PATH, name: UNDERBANNER_NAME },
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    logger.info(`[ReliableTickets] REVIEW_READY type=${type} user=${interaction.user.id} ms=${Date.now() - started}`);
}

async function resolveRole(guild: ModalSubmitInteraction['guild'], roleId: string) {
    if (!guild) return null;
    return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

function optionalField(interaction: ModalSubmitInteraction, id: string): string {
    try {
        return interaction.fields.getTextInputValue(id).trim();
    } catch {
        return '';
    }
}

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the server.', flags: MessageFlags.Ephemeral });
        return;
    }

    const started = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info(`[ReliableTickets] ACK modal type=${type} user=${interaction.user.id} ms=${Date.now() - started}`);

    const config = CATEGORIES[type];
    const reason = optionalField(interaction, 'reason') || 'support';
    // Older ticket modals did not always contain the details field. Treat all
    // non-required fields as optional so a modal created before a deploy can
    // still be submitted successfully afterward.
    const details = optionalField(interaction, 'details') || optionalField(interaction, 'anything_else');
    const supportRole = await resolveRole(guild, SUPPORT_ROLE_ID);
    const categoryRole = config.roleId === SUPPORT_ROLE_ID ? supportRole : await resolveRole(guild, config.roleId);

    const staffRoleIds = Array.from(new Set([supportRole?.id, categoryRole?.id].filter((id): id is string => Boolean(id))));
    const overwrites = [
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
        // Create outside every category first. A category-level deny cannot
        // prevent the ticket from existing.
        channel = await guild.channels.create({
            name: `${config.prefix}-${safeName(reason)}-${interaction.user.id.slice(-4)}`.slice(0, 40),
            type: ChannelType.GuildText,
            topic: topic(interaction.user.id, type),
            permissionOverwrites: overwrites,
            reason: `${config.label} ticket opened by ${interaction.user.tag}`,
        });
        logger.info(`[ReliableTickets] CHANNEL_CREATED type=${type} channel=${channel.id} user=${interaction.user.id}`);

        const targetCategory = guild.channels.cache.get(config.parentId)
            || await guild.channels.fetch(config.parentId).catch(() => null);
        if (targetCategory?.type === ChannelType.GuildCategory) {
            await channel.setParent(targetCategory.id, {
                lockPermissions: false,
                reason: `${config.label} ticket routing`,
            }).then(() => {
                logger.info(`[ReliableTickets] CHANNEL_MOVED type=${type} channel=${channel?.id} parent=${targetCategory.id}`);
            }).catch(error => {
                logger.warn(`[ReliableTickets] MOVE_FAILED type=${type} channel=${channel?.id} parent=${targetCategory.id} error=${error instanceof Error ? error.message : String(error)}`);
            });
        } else {
            logger.warn(`[ReliableTickets] CATEGORY_MISSING type=${type} expected=${config.parentId}; ticket remains at guild level.`);
        }

        const extraLines: string[] = [];
        if (type === 'internal') {
            const reportedUser = optionalField(interaction, 'reported_user');
            const proof = optionalField(interaction, 'proof');
            if (reportedUser) extraLines.push(`**User Reported:** ${reportedUser}`);
            if (proof) extraLines.push(`**Proof:** ${proof}`);
        }
        if (details) extraLines.push(`**Additional Details:** ${details.slice(0, 1000)}`);

        const pingRoleId = categoryRole?.id || supportRole?.id;
        const panel = await channel.send({
            content: [
                pingRoleId ? `<@${interaction.user.id}> | <@&${pingRoleId}>` : `<@${interaction.user.id}>`,
                `## 🎫 ${config.label} Ticket`,
                `**Opened By:** <@${interaction.user.id}>`,
                '**Reason:**',
                reason.slice(0, 1500),
                ...extraLines,
                '',
                'A staff member will assist you shortly.',
            ].join('\n'),
            components: [ticketButtons()],
            allowedMentions: {
                parse: [],
                users: [interaction.user.id],
                roles: pingRoleId ? [pingRoleId] : [],
            },
        });
        logger.info(`[ReliableTickets] PANEL_SENT type=${type} channel=${channel.id} message=${panel.id}`);

        await channel.setTopic(topic(interaction.user.id, type, panel.id), 'Ticket panel linked.').catch(error => {
            logger.warn(`[ReliableTickets] TOPIC_LINK_FAILED channel=${channel?.id} error=${error instanceof Error ? error.message : String(error)}`);
        });

        await interaction.editReply(`✅ Your ${config.label} ticket has been created: <#${channel.id}>`);
        logger.info(`[ReliableTickets] COMPLETE type=${type} channel=${channel.id} user=${interaction.user.id} totalMs=${Date.now() - started}`);
    } catch (error) {
        logger.error(`[ReliableTickets] CREATE_FAILED type=${type} user=${interaction.user.id} channel=${channel?.id || 'none'} error=${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (channel) {
            await interaction.editReply(`Your ticket channel was created but setup did not finish: <#${channel.id}>. Staff can still assist you there.`).catch(() => undefined);
        } else {
            await interaction.editReply(`Unable to create your **${config.label}** ticket. Please contact an administrator.`).catch(() => undefined);
        }
    }
}

function parseContinueCustomId(customId: string): { type: string; ownerId: string } | null {
    const prefixes = ['reliable-ticket:continue:', 'direct-ticket:continue:'];
    const prefix = prefixes.find(candidate => customId.startsWith(candidate));
    if (!prefix) return null;
    const remainder = customId.slice(prefix.length);
    const [type, ownerId] = remainder.split(':');
    return type && ownerId ? { type, ownerId } : null;
}

function parseCreateCustomId(customId: string): string | null {
    for (const prefix of ['reliable-ticket:create:', 'direct-ticket:create:']) {
        if (customId.startsWith(prefix)) return customId.slice(prefix.length).split(':')[0] || null;
    }
    return null;
}

export async function handleReliableTicketInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create-select') {
        const type = interaction.values[0] || '';
        if (!isTicketType(type)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await showReview(interaction, type);
        return true;
    }

    if (interaction.isButton()) {
        const parsed = parseContinueCustomId(interaction.customId);
        if (parsed) {
            if (!isTicketType(parsed.type)) {
                await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (parsed.ownerId !== interaction.user.id) {
                await interaction.reply({ content: 'This ticket form belongs to another user.', flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.showModal(ticketModal(parsed.type));
            logger.info(`[ReliableTickets] MODAL_OPEN type=${parsed.type} user=${interaction.user.id} source=${interaction.customId.startsWith('direct-ticket:') ? 'legacy' : 'current'}`);
            return true;
        }
    }

    if (interaction.isModalSubmit()) {
        const type = parseCreateCustomId(interaction.customId);
        if (type) {
            if (!isTicketType(type)) {
                await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
                return true;
            }
            await createTicket(interaction, type);
            return true;
        }
    }

    return false;
}
