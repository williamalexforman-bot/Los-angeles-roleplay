import { resolve } from 'path';
import {
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
    type Guild,
    type GuildMember,
    type Interaction,
    type Role,
    type StringSelectMenuInteraction,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { SUPPORT_FAQ, TICKET_TERMS } from '../commands/supportContent';
import { logger } from '../utils/logger';

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID
    || process.env.GENERAL_SUPPORT_ROLE_ID
    || '1523122697746382868';
const INTERNAL_ROLE_ID = process.env.INTERNAL_AFFAIRS_ROLE_ID || '1521593407816990811';

const BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const BANNER_PATH = resolve(__dirname, '..', '..', 'assets', BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

const TICKET_TYPES = {
    general: { label: 'General Support', emoji: '🎫' },
    internal: { label: 'Internal Affairs Support', emoji: '📋' },
    management: { label: 'Management Support', emoji: '🏛️' },
    highrank: { label: 'Directorship / Ownership', emoji: '⭐' },
} as const;

type TicketType = keyof typeof TICKET_TYPES;

type RawComponent = {
    type?: number;
    custom_id?: string;
    label?: string;
    style?: number;
    disabled?: boolean;
    components?: RawComponent[];
};

type TicketMetadata = {
    ownerId?: string;
    type?: string;
    createdAt?: string;
    claimedBy?: string;
    panelMessageId?: string;
};

function isTicketType(value: string): value is TicketType {
    return Object.prototype.hasOwnProperty.call(TICKET_TYPES, value);
}

function decodeTicketMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        return JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
    } catch {
        return null;
    }
}

function encodeTicketMetadata(metadata: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
}

function ticketStaffRoleIds(): string[] {
    return [
        SUPPORT_ROLE_ID,
        INTERNAL_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value));
}

function isTicketStaff(interaction: ButtonInteraction | ChatInputCommandInteraction): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    const member = interaction.member as GuildMember | null;
    if (!member?.roles || !('cache' in member.roles)) return false;
    return ticketStaffRoleIds().some(roleId => member.roles.cache.has(roleId));
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(BANNER_PATH, { name: BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function reviewPanel(type: TicketType, userId: string): ContainerBuilder {
    const config = TICKET_TYPES[type];
    const continueButton = new ButtonBuilder()
        .setCustomId(`ticket:continue:${type}:${userId}`)
        .setLabel('Continue to Ticket Form')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary);

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## ${config.emoji} ${config.label}`,
            'Before opening your ticket, review the FAQ and Ticket Terms of Service below.',
            '',
            SUPPORT_FAQ,
        ].join('\n').slice(0, 3_800)))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            TICKET_TERMS,
            '',
            '**Press Continue to open the ticket form.**',
        ].join('\n').slice(0, 3_800)))
        .addSeparatorComponents(separator())
        .addActionRowComponents(row => row.addComponents(continueButton))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function sendReview(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    type: TicketType,
): Promise<boolean> {
    if (interaction.replied || interaction.deferred) return false;
    await interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [reviewPanel(type, interaction.user.id)],
        files: artwork(),
    });
    logger.info(`[Tickets] REVIEW_READY_SAFE type=${type} user=${interaction.user.id}`);
    return true;
}

async function handleTicketCategorySelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:create-select') return false;
    const type = interaction.values[0] || '';
    if (!isTicketType(type)) {
        await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }
    return sendReview(interaction, type);
}

async function handleLegacyTicketCategoryButton(interaction: ButtonInteraction): Promise<boolean> {
    const legacy: Record<string, TicketType> = {
        'ticket-general': 'general',
        'ticket-internal': 'internal',
        'ticket-internal-affairs': 'internal',
        'ticket-management': 'management',
        'ticket-highrank': 'highrank',
        'ticket-high-rank': 'highrank',
        'ticket-directorship': 'highrank',
        'ticket-ownership': 'highrank',
    };
    const type = legacy[interaction.customId];
    if (!type) return false;
    return sendReview(interaction, type);
}

function mutateClaimButton(components: RawComponent[], claimedBy?: string): RawComponent[] {
    const visit = (node: RawComponent): void => {
        if (node.custom_id === 'ticket:claim') {
            node.label = claimedBy ? `Claimed by ${claimedBy}`.slice(0, 80) : 'Claim';
            node.style = ButtonStyle.Success;
            node.disabled = Boolean(claimedBy);
            return;
        }
        node.components?.forEach(visit);
    };
    components.forEach(visit);
    return components;
}

function preserveV2ClaimState(interaction: ButtonInteraction, claimedBy?: string): RawComponent[] {
    const components = interaction.message.components.map(component => component.toJSON()) as unknown as RawComponent[];
    return mutateClaimButton(components, claimedBy);
}

async function handleClaim(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:claim') return false;
    if (!isTicketStaff(interaction)) return false;
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const metadata = decodeTicketMetadata(channel.topic);
    if (metadata) {
        metadata.claimedBy = interaction.user.id;
        await channel.setTopic(encodeTicketMetadata(metadata), 'Ticket claimed').catch(() => undefined);
    }

    await interaction.update({ components: preserveV2ClaimState(interaction, interaction.user.username) as never });
    logger.info(`[Tickets] CLAIMED channel=${channel.id} by=${interaction.user.id} v2Preserved=true`);
    return true;
}

async function handleUnclaim(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName !== 'unclaim') return false;
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    if (!isTicketStaff(interaction)) return false;

    const data = decodeTicketMetadata(channel.topic);
    if (!data) return false;
    delete data.claimedBy;
    await channel.setTopic(encodeTicketMetadata(data), 'Ticket unclaimed').catch(() => undefined);

    if (data.panelMessageId) {
        const panel = await channel.messages.fetch(data.panelMessageId).catch(() => null);
        if (panel) {
            const components = panel.components.map(component => component.toJSON()) as unknown as RawComponent[];
            await panel.edit({ components: mutateClaimButton(components) as never }).catch(error => {
                logger.warn(`[Tickets] UNCLAIM_PANEL_EDIT_FAILED channel=${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }

    await interaction.reply({ content: '✅ Ticket unclaimed.', flags: MessageFlags.Ephemeral });
    logger.info(`[Tickets] UNCLAIMED channel=${channel.id} by=${interaction.user.id} v2Preserved=true`);
    return true;
}

async function handleMemberCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const add = interaction.commandName === 'add-member';
    const remove = interaction.commandName === 'remove-member';
    if (!add && !remove) return false;

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    if (!isTicketStaff(interaction)) return false;
    if (!decodeTicketMetadata(channel.topic)) return false;

    const user = interaction.options.getUser('member', true);
    if (add) {
        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
        });
    } else {
        await channel.permissionOverwrites.delete(user.id).catch(async () => {
            await channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
        });
    }

    await interaction.reply({
        content: `✅ ${add ? 'Added' : 'Removed'} <@${user.id}> ${add ? 'to' : 'from'} this ticket.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { users: [] },
    });
    logger.info(`[Tickets] MEMBER_${add ? 'ADDED' : 'REMOVED'} channel=${channel.id} member=${user.id} by=${interaction.user.id}`);
    return true;
}

function roleByName(guild: Guild, pattern: RegExp): Role | null {
    return guild.roles.cache
        .filter(role => role.id !== guild.id && !role.managed && pattern.test(role.name))
        .sort((a, b) => b.position - a.position)
        .first() || null;
}

async function fetchConfiguredRole(guild: Guild, id?: string): Promise<Role | null> {
    if (!id) return null;
    return guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
}

async function escalationRoles(guild: Guild): Promise<Role[]> {
    const candidates: Array<Role | null> = [
        await fetchConfiguredRole(guild, process.env.HIGH_RANK_ROLE_ID),
        await fetchConfiguredRole(guild, process.env.MANAGEMENT_ROLE_ID),
        roleByName(guild, /\b(owner|ownership|directorship|director|executive|high[ -]?rank)\b/i),
        roleByName(guild, /\b(management|manager|senior staff|leadership)\b/i),
    ];
    const unique = new Map<string, Role>();
    for (const role of candidates) if (role) unique.set(role.id, role);
    if (!unique.size) {
        const support = await fetchConfiguredRole(guild, SUPPORT_ROLE_ID);
        if (support) unique.set(support.id, support);
    }
    return [...unique.values()].slice(0, 2);
}

async function handleEscalate(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:escalate') return false;
    if (!isTicketStaff(interaction)) return false;
    const channel = interaction.channel;
    const guild = interaction.guild;
    if (!guild || !channel || channel.type !== ChannelType.GuildText) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roles = await escalationRoles(guild);
    if (!roles.length) {
        await interaction.editReply('No valid escalation role could be found.');
        logger.warn(`[Tickets] ESCALATE_NO_ROLE channel=${channel.id} by=${interaction.user.id}`);
        return true;
    }

    for (const role of roles) {
        await (channel as TextChannel).permissionOverwrites.edit(role.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        }).catch(error => logger.warn(`[Tickets] ESCALATE_PERMISSION_FAILED channel=${channel.id} role=${role.id}: ${error instanceof Error ? error.message : String(error)}`));
    }

    await channel.send({
        content: `${roles.map(role => `<@&${role.id}>`).join(' ')} 🚨 This ticket has been escalated by <@${interaction.user.id}>.`,
        allowedMentions: { roles: roles.map(role => role.id), users: [interaction.user.id] },
    });
    await interaction.editReply(`Ticket escalated to ${roles.map(role => `@${role.name}`).join(' and ')}.`);
    logger.info(`[Tickets] ESCALATED channel=${channel.id} by=${interaction.user.id} roles=${roles.map(role => `${role.name}:${role.id}`).join(',')}`);
    return true;
}

export async function handleDirectTicketInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isStringSelectMenu()) {
        if (await handleTicketCategorySelect(interaction)) return true;
        return false;
    }
    if (interaction.isButton()) {
        if (await handleLegacyTicketCategoryButton(interaction)) return true;
        if (await handleClaim(interaction)) return true;
        if (await handleEscalate(interaction)) return true;
        return false;
    }
    if (interaction.isChatInputCommand()) {
        if (await handleUnclaim(interaction)) return true;
        if (await handleMemberCommand(interaction)) return true;
    }
    return false;
}
