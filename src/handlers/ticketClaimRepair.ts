import {
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    type APIInteractionGuildMember,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const claimLocks = new Set<string>();

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
    return Boolean(
        fetched?.permissions.has(PermissionFlagsBits.Administrator)
        || fetched?.permissions.has(PermissionFlagsBits.ManageChannels)
        || fetched?.roles.cache.has(TICKET_SUPPORT_ROLE_ID),
    );
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

async function freshMetadata(channel: TextChannel): Promise<TicketMetadata | null> {
    const refreshed = await channel.fetch().catch(() => null);
    if (!refreshed || refreshed.type !== ChannelType.GuildText) return decodeMetadata(channel.topic);
    return decodeMetadata(refreshed.topic);
}

async function dmTicketOwnerClaimed(
    interaction: ButtonInteraction,
    metadata: TicketMetadata,
    channel: TextChannel,
): Promise<void> {
    try {
        const owner = await interaction.client.users.fetch(metadata.ownerId);
        await owner.send({
            content: [
                '🎫 **Your ticket has been claimed!**',
                '',
                `**Claimed by:** ${interaction.user.tag}`,
                `**Ticket:** #${channel.name}`,
                '',
                'A staff member is now handling your ticket. Please continue the conversation in the ticket channel.',
            ].join('\n'),
        });
        logger.info(`[TicketClaimRepair] Sent claim DM to ticket opener ${metadata.ownerId}.`);
    } catch (error) {
        logger.warn(`[TicketClaimRepair] Could not DM ticket opener ${metadata.ownerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function handleTicketClaimRepair(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:claim') return false;

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'This claim button is not inside a managed ticket channel.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (claimLocks.has(channel.id)) {
        await interaction.reply({
            content: 'Someone is already claiming this ticket. Please wait a moment.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
        return true;
    }

    claimLocks.add(channel.id);
    try {
        // Stop Discord's button spinner before any permission or channel REST
        // request. The claim result is reported through follow-ups below.
        await interaction.deferUpdate();

        if (!(await canClaim(interaction))) {
            await interaction.followUp({
                content: `Only members of <@&${TICKET_SUPPORT_ROLE_ID}> or staff with Manage Channels can claim tickets.`,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });
            return true;
        }

        const metadata = await freshMetadata(channel);
        if (!metadata) {
            await interaction.followUp({ content: 'This is not a managed ticket.', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (metadata.claimedBy) {
            await interaction.followUp({
                content: metadata.claimedBy === interaction.user.id
                    ? 'You already claimed this ticket.'
                    : `This ticket is already claimed by <@${metadata.claimedBy}>.`,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });
            return true;
        }

        const originalMetadata = { ...metadata };
        const claimedMetadata = {
            ...metadata,
            claimedBy: interaction.user.id,
            panelMessageId: interaction.message.id,
        };

        try {
            await channel.setTopic(encodeMetadata(claimedMetadata), `Ticket claimed by ${interaction.user.id}`);
            await interaction.editReply({
                components: claimedComponents(interaction) as never,
            });
        } catch (error) {
            await channel.setTopic(encodeMetadata(originalMetadata), 'Rolling back failed ticket claim').catch(() => undefined);
            logger.error(`[TicketClaimRepair] Claim failed in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
            await interaction.followUp({
                content: 'I could not finish claiming this ticket, so the claim was rolled back. Please try again.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => undefined);
            return true;
        }

        await interaction.followUp({
            content: `✅ Ticket claimed by <@${interaction.user.id}>.`,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
        // A slow or disabled DM must never hold the claim interaction open.
        void dmTicketOwnerClaimed(interaction, claimedMetadata, channel);
        logger.info(`[TicketClaimRepair] ${channel.id} claimed by ${interaction.user.id}.`);
        return true;
    } finally {
        claimLocks.delete(channel.id);
    }
}
