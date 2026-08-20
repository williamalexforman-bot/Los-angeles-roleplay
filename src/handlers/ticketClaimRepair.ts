import {
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    type APIInteractionGuildMember,
} from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';

type TicketMetadata = {
    ownerId: string;
    type: string;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
    [key: string]: unknown;
};

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
        return parsed?.ownerId ? parsed : null;
    } catch {
        return null;
    }
}

function encodeMetadata(metadata: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
}

function cachedRoleIds(member: ButtonInteraction['member']): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    const apiMember = member as APIInteractionGuildMember;
    return Array.isArray(apiMember.roles) ? apiMember.roles : [];
}

async function canClaim(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;

    if (cachedRoleIds(interaction.member).includes(TICKET_SUPPORT_ROLE_ID)) return true;

    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(TICKET_SUPPORT_ROLE_ID));
}

function claimedComponents(interaction: ButtonInteraction): unknown[] {
    const components = interaction.message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    const visit = (node: Record<string, unknown>): void => {
        if (node.custom_id === 'ticket:claim') {
            node.label = `Claimed by ${interaction.user.username}`.slice(0, 80);
            node.disabled = true;
            node.style = ButtonStyle.Secondary;
        }
        const children = node.components as Array<Record<string, unknown>> | undefined;
        if (children) children.forEach(visit);
    };
    components.forEach(visit);
    return components;
}

export async function handleTicketClaimRepair(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:claim') return false;

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'This claim button is not inside a managed ticket channel.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const metadata = decodeMetadata(channel.topic);
    if (!metadata) {
        await interaction.reply({ content: 'This is not a managed ticket.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!(await canClaim(interaction))) {
        await interaction.reply({
            content: `Only members of <@&${TICKET_SUPPORT_ROLE_ID}> or staff with Manage Channels can claim tickets.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (metadata.claimedBy) {
        await interaction.reply({ content: `This ticket is already claimed by <@${metadata.claimedBy}>.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferUpdate();
    const originalMetadata = { ...metadata };
    metadata.claimedBy = interaction.user.id;
    metadata.panelMessageId = interaction.message.id;

    try {
        await channel.setTopic(encodeMetadata(metadata), `Ticket claimed by ${interaction.user.id}`);
        await interaction.message.edit({
            components: claimedComponents(interaction) as never,
            attachments: Array.from(interaction.message.attachments.values()),
        });
    } catch (error) {
        await channel.setTopic(encodeMetadata(originalMetadata), 'Rolling back failed ticket claim').catch(() => undefined);
        logger.error(`[TicketClaimRepair] Claim failed in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
        await interaction.followUp({
            content: 'I could not update the ticket claim panel. The claim was rolled back; please try again.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return true;
    }

    await interaction.followUp({
        content: `✅ Ticket claimed by <@${interaction.user.id}>.`,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
    logger.info(`[TicketClaimRepair] ${channel.id} claimed by ${interaction.user.id}.`);
    return true;
}
