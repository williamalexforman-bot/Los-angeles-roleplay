import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    type Client,
    type Guild,
    type GuildMember,
    type ModalSubmitInteraction,
    type Role,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID || process.env.GENERAL_SUPPORT_ROLE_ID || '1523122697746382868';
const INTERNAL_ROLE_ID = process.env.INTERNAL_AFFAIRS_ROLE_ID || '1521593407816990811';

const CATEGORIES = {
    general: {
        label: 'General Support', emoji: '🎫', prefix: 'gen',
        parentId: process.env.GENERAL_TICKET_CATEGORY_ID || '1526254341646712883',
        roleId: SUPPORT_ROLE_ID,
    },
    internal: {
        label: 'Internal Affairs Support', emoji: '📋', prefix: 'ia',
        parentId: process.env.INTERNAL_TICKET_CATEGORY_ID || '1526254402426503320',
        roleId: INTERNAL_ROLE_ID,
    },
    management: {
        label: 'Management Support', emoji: '🏛️', prefix: 'mgmt',
        parentId: process.env.MANAGEMENT_TICKET_CATEGORY_ID || '1526254462128099479',
        roleId: process.env.MANAGEMENT_ROLE_ID || SUPPORT_ROLE_ID,
    },
    highrank: {
        label: 'Directorship / Ownership', emoji: '⭐', prefix: 'hr',
        parentId: process.env.HIGH_RANK_TICKET_CATEGORY_ID || '1526254518570844231',
        roleId: process.env.HIGH_RANK_ROLE_ID || SUPPORT_ROLE_ID,
    },
} as const;

type TicketType = keyof typeof CATEGORIES;

type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

function isTicketType(value: string): value is TicketType {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

function cleanName(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22) || 'support';
}

function encodeMetadata(value: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}

function optionalField(interaction: ModalSubmitInteraction, id: string): string {
    try {
        return interaction.fields.getTextInputValue(id).trim();
    } catch {
        return '';
    }
}

async function resolveRole(guild: Guild, preferredRoleId: string): Promise<Role | null> {
    const preferred = guild.roles.cache.get(preferredRoleId) || await guild.roles.fetch(preferredRoleId).catch(() => null);
    if (preferred) return preferred;
    if (preferredRoleId === SUPPORT_ROLE_ID) return null;
    return guild.roles.cache.get(SUPPORT_ROLE_ID) || await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
}

function actionRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ticket:escalate').setLabel('Escalate').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
    );
}

function openingText(params: {
    type: TicketType;
    userId: string;
    roleId?: string;
    reason: string;
    reportedUser?: string;
    proof?: string;
    details?: string;
}): string {
    const config = CATEGORIES[params.type];
    const lines = [
        params.roleId ? `<@${params.userId}> <@&${params.roleId}>` : `<@${params.userId}>`,
        '',
        `## ${config.emoji} ${config.label} Ticket`,
        'Thank you for contacting Los Angeles Roleplay Support. A staff member will assist you shortly.',
        '',
        `**Opened By:** <@${params.userId}>`,
        `**Reason:** ${params.reason.slice(0, 1400)}`,
    ];
    if (params.reportedUser) lines.push(`**User Reported:** ${params.reportedUser.slice(0, 500)}`);
    if (params.proof) lines.push(`**Proof:** ${params.proof.slice(0, 1000)}`);
    if (params.details) lines.push(`**Additional Details:** ${params.details.slice(0, 1000)}`);
    return lines.join('\n').slice(0, 3900);
}

async function createLegacyTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the server.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const config = CATEGORIES[type];
    const reason = optionalField(interaction, 'reason') || 'support';
    const details = optionalField(interaction, 'details');
    const reportedUser = optionalField(interaction, 'reported_user');
    const proof = optionalField(interaction, 'proof');
    const role = await resolveRole(guild, config.roleId);

    const permissionOverwrites: any[] = [
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

    if (role) {
        permissionOverwrites.push({
            id: role.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        });
    }

    let channel: TextChannel | null = null;
    try {
        channel = await guild.channels.create({
            name: `${config.prefix}-${cleanName(reason)}-${interaction.user.id.slice(-4)}`.slice(0, 40),
            type: ChannelType.GuildText,
            permissionOverwrites,
            topic: encodeMetadata({ ownerId: interaction.user.id, type, createdAt: new Date().toISOString() }),
            reason: `${config.label} ticket opened by ${interaction.user.tag}`,
        });

        const parent = guild.channels.cache.get(config.parentId) || await guild.channels.fetch(config.parentId).catch(() => null);
        if (parent?.type === ChannelType.GuildCategory) {
            await channel.setParent(parent.id, { lockPermissions: false, reason: `${config.label} ticket routing` }).catch(error => {
                logger.warn(`[LegacyTickets] MOVE_FAILED channel=${channel?.id} parent=${config.parentId}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }

        const panel = await channel.send({
            content: openingText({
                type,
                userId: interaction.user.id,
                roleId: role?.id,
                reason,
                reportedUser,
                proof,
                details,
            }),
            components: [actionRow()],
            allowedMentions: {
                parse: [],
                users: [interaction.user.id],
                roles: role ? [role.id] : [],
            },
        });

        await channel.setTopic(encodeMetadata({
            ownerId: interaction.user.id,
            type,
            createdAt: new Date().toISOString(),
            panelMessageId: panel.id,
        }), 'Ticket metadata').catch(() => undefined);

        await interaction.editReply(`✅ Your ${config.label} ticket has been created: <#${channel.id}>`);
        logger.info(`[LegacyTickets] COMPLETE type=${type} channel=${channel.id} user=${interaction.user.id}`);
    } catch (error) {
        logger.error(`[LegacyTickets] CREATE_FAILED type=${type} channel=${channel?.id || 'none'}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (channel) {
            await interaction.editReply(`Your ticket channel was created, but the opening message failed: <#${channel.id}>`).catch(() => undefined);
        } else {
            await interaction.editReply('Unable to create your ticket. Please contact an administrator.').catch(() => undefined);
        }
    }
}

/**
 * Replaces the newer ticket modal submit implementation with a simple,
 * legacy-style opening message. Existing ticket buttons keep using the normal
 * ticket handlers because the topic metadata and custom IDs remain compatible.
 */
export function installLegacyTicketSubmitPatch(_client: Client): void {
    const tickets = require('../commands/tickets.ts') as {
        handleTicketModal?: (interaction: ModalSubmitInteraction) => Promise<boolean>;
    };

    tickets.handleTicketModal = async (interaction: ModalSubmitInteraction): Promise<boolean> => {
        if (!interaction.customId.startsWith('ticket:create:')) return false;
        const type = interaction.customId.split(':')[2] || '';
        if (!isTicketType(type)) {
            if (interaction.deferred) await interaction.editReply('That ticket category is unavailable.');
            else await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await createLegacyTicket(interaction, type);
        return true;
    };

    logger.warn('[LegacyTickets] ACTIVE: modal submissions use the simple opening format with Escalate / Claim / Close only.');
}
