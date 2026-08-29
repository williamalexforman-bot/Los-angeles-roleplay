import {
    ButtonStyle,
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    type ButtonInteraction,
    type Guild,
    type Interaction,
    type Role,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID
    || process.env.GENERAL_SUPPORT_ROLE_ID
    || '1523122697746382868';

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

function decodeTicketMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        return JSON.parse(
            Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8'),
        ) as TicketMetadata;
    } catch {
        return null;
    }
}

function encodeTicketMetadata(metadata: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
}

function preserveV2AndMarkClaimed(interaction: ButtonInteraction): RawComponent[] {
    const components = interaction.message.components.map(component => component.toJSON()) as unknown as RawComponent[];

    const visit = (node: RawComponent): void => {
        if (node.custom_id === 'ticket:claim') {
            node.label = `Claimed by ${interaction.user.username}`.slice(0, 80);
            node.style = ButtonStyle.Success;
            node.disabled = true;
            return;
        }
        node.components?.forEach(visit);
    };

    components.forEach(visit);
    return components;
}

async function handleClaim(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:claim') return false;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return false;

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const metadata = decodeTicketMetadata(channel.topic);
    if (metadata) {
        metadata.claimedBy = interaction.user.id;
        await channel.setTopic(encodeTicketMetadata(metadata), 'Ticket claimed').catch(() => undefined);
    }

    const fullV2Tree = preserveV2AndMarkClaimed(interaction);
    await interaction.update({ components: fullV2Tree as never });
    logger.info(`[Tickets] CLAIMED channel=${channel.id} by=${interaction.user.id} v2Preserved=true`);
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
    for (const role of candidates) {
        if (role) unique.set(role.id, role);
    }

    if (!unique.size) {
        const support = await fetchConfiguredRole(guild, SUPPORT_ROLE_ID);
        if (support) unique.set(support.id, support);
    }

    return [...unique.values()].slice(0, 2);
}

async function handleEscalate(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:escalate') return false;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return false;

    const channel = interaction.channel;
    const guild = interaction.guild;
    if (!guild || !channel || channel.type !== ChannelType.GuildText) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roles = await escalationRoles(guild);
    if (!roles.length) {
        await interaction.editReply('No valid escalation role could be found. Add MANAGEMENT_ROLE_ID or HIGH_RANK_ROLE_ID in Render.');
        logger.warn(`[Tickets] ESCALATE_NO_ROLE channel=${channel.id} by=${interaction.user.id}`);
        return true;
    }

    for (const role of roles) {
        await (channel as TextChannel).permissionOverwrites.edit(role.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        }).catch(error => {
            logger.warn(`[Tickets] ESCALATE_PERMISSION_FAILED channel=${channel.id} role=${role.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    const mentions = roles.map(role => `<@&${role.id}>`).join(' ');
    await channel.send({
        content: `${mentions} 🚨 This ticket has been escalated by <@${interaction.user.id}>.`,
        allowedMentions: {
            roles: roles.map(role => role.id),
            users: [interaction.user.id],
        },
    });

    await interaction.editReply(`Ticket escalated to ${roles.map(role => `@${role.name}`).join(' and ')}.`);
    logger.info(`[Tickets] ESCALATED channel=${channel.id} by=${interaction.user.id} roles=${roles.map(role => `${role.name}:${role.id}`).join(',')}`);
    return true;
}

/**
 * Small pre-router ticket fixes. Ticket opening/creation remains exclusively in
 * src/commands/tickets.ts; only claim/escalate are intercepted here so the V2
 * message can be preserved and escalation roles can be resolved dynamically.
 */
export async function handleDirectTicketInteraction(interaction: Interaction): Promise<boolean> {
    if (!interaction.isButton()) return false;
    if (await handleClaim(interaction)) return true;
    if (await handleEscalate(interaction)) return true;
    return false;
}
