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
import { sendTicketClaimedDm } from '../commands/ticketLifecycleEnhancements';

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const claimLocks = new Set<string>();

type TicketMetadata = {
    ownerId: string;
    type: 'general' | 'internal' | 'management' | 'highrank';
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
            node.style = ButtonStyle.Success;
        }
        const children = node.components as Array<Record<string, unknown>> | undefined;
        if (children) children.forEach(visit);
    };
    components.forEach(visit);
    return components;
}

async function dmTicketOwnerClaimed(
    interaction: ButtonInteraction,
    metadata: TicketMetadata,
    channel: TextChannel,
): Promise<void> {
    try {
        const sent = await sendTicketClaimedDm(interaction, metadata, channel);
        if (sent) logger.info(`[TicketClaimRepair] Sent V2 claim DM to ticket opener ${metadata.ownerId}.`);
        else logger.warn(`[TicketClaimRepair] Discord did not deliver the claim DM to ticket opener ${metadata.ownerId}.`);
    } catch (error) {
        logger.warn(`[TicketClaimRepair] Could not DM ticket opener ${metadata.ownerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function persistClaim(
    interaction: ButtonInteraction,
    channel: TextChannel,
    claimedMetadata: TicketMetadata,
): Promise<void> {
    try {
        await channel.setTopic(encodeMetadata(claimedMetadata), `Ticket claimed by ${interaction.user.id}`);
        logger.info(`[TicketClaimRepair] ${channel.id} claimed by ${interaction.user.id}.`);
    } catch (error) {
        logger.error(`[TicketClaimRepair] Claim metadata save failed in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
        await interaction.followUp({
            content: '⚠️ The ticket was visually claimed, but I could not save the claim metadata. Please tell an administrator if this persists.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
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
        // Acknowledge the click immediately. Everything else happens after the
        // button spinner is already gone.
        await interaction.deferUpdate();

        if (!(await canClaim(interaction))) {
            await interaction.followUp({
                content: `Only members of <@&${TICKET_SUPPORT_ROLE_ID}> or staff with Manage Channels can claim tickets.`,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });
            return true;
        }

        // Use the metadata already delivered with the interaction instead of
        // performing a channel.fetch() before the UI can change.
        const metadata = decodeMetadata(channel.topic);
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

        const claimedMetadata: TicketMetadata = {
            ...metadata,
            claimedBy: interaction.user.id,
            panelMessageId: interaction.message.id,
        };

        // Change the button FIRST. This is the visible action staff expect to
        // happen the instant they press Claim.
        await interaction.editReply({
            components: claimedComponents(interaction) as never,
        });

        // Metadata persistence and the owner DM are intentionally off the
        // critical interaction path so Discord/network latency cannot make the
        // claim button feel slow.
        void persistClaim(interaction, channel, claimedMetadata);
        void dmTicketOwnerClaimed(interaction, claimedMetadata, channel);

        await interaction.followUp({
            content: `✅ Ticket claimed by <@${interaction.user.id}>.`,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
        return true;
    } finally {
        claimLocks.delete(channel.id);
    }
}
