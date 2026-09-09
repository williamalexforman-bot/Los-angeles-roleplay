import {
    ChannelType,
    PermissionFlagsBits,
    type Client,
    type Guild,
    type Role,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const INTERNAL_AFFAIRS_PING_ROLE_ID = '1546570946322632865';
const registeredClients = new WeakSet<Client>();

type TicketType = 'general' | 'internal' | 'management' | 'highrank';

type TicketMetadata = {
    ownerId?: string;
    type?: TicketType;
    createdAt?: string;
};

function decodeTicketMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const decoded = Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8');
        return JSON.parse(decoded) as TicketMetadata;
    } catch {
        return null;
    }
}

async function fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
    return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function findHighRankRole(guild: Guild): Promise<Role | null> {
    const dynamicId = (globalThis as any).__serverRoleIdsByKey?.[guild.id]?.highRank as string | undefined;
    const configuredId = process.env.HIGH_RANK_ROLE_ID;

    for (const roleId of [dynamicId, configuredId].filter((value): value is string => Boolean(value))) {
        const role = await fetchRole(guild, roleId);
        if (role) return role;
    }

    const exactNames = new Set([
        'high rank',
        'high ranks',
        'high rank team',
        'csrp | high rank',
        'california state roleplay | high rank',
    ]);

    const exact = guild.roles.cache
        .filter(role => exactNames.has(role.name.trim().toLowerCase()))
        .sort((a, b) => b.position - a.position)
        .first();
    if (exact) return exact;

    return guild.roles.cache
        .filter(role => !role.managed && /\bhigh[ -]?rank(?:s| team)?\b/i.test(role.name))
        .sort((a, b) => b.position - a.position)
        .first() || null;
}

async function grantTicketRole(channel: TextChannel, role: Role): Promise<void> {
    await channel.permissionOverwrites.edit(role.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
    }, { reason: `Ticket access for ${role.name}` });
}

async function configureOpenedTicket(channel: TextChannel, type: TicketType): Promise<void> {
    if (type === 'general') {
        await channel.send({
            content: '@everyone 🎫 A new **General Support** ticket has been opened.',
            allowedMentions: { parse: ['everyone'] },
        });
        logger.info(`[TicketRouting] General Support pinged @everyone in ${channel.id}.`);
        return;
    }

    if (type === 'internal') {
        const role = await fetchRole(channel.guild, INTERNAL_AFFAIRS_PING_ROLE_ID);
        if (!role) {
            logger.warn(`[TicketRouting] Internal Affairs role ${INTERNAL_AFFAIRS_PING_ROLE_ID} could not be found for ${channel.id}.`);
            return;
        }
        await grantTicketRole(channel, role);
        await channel.send({
            content: `<@&${role.id}> 📋 A new **Internal Affairs** ticket has been opened.`,
            allowedMentions: { parse: [], roles: [role.id] },
        });
        logger.info(`[TicketRouting] Internal Affairs role ${role.id} granted access and pinged in ${channel.id}.`);
        return;
    }

    if (type === 'highrank') {
        const role = await findHighRankRole(channel.guild);
        if (!role) {
            logger.warn(`[TicketRouting] High Rank role could not be resolved for ${channel.id}; ping was not sent.`);
            return;
        }
        await grantTicketRole(channel, role);
        await channel.send({
            content: `<@&${role.id}> ⭐ A new **High Rank** ticket has been opened.`,
            allowedMentions: { parse: [], roles: [role.id] },
        });
        logger.info(`[TicketRouting] High Rank role ${role.id} granted access and pinged in ${channel.id}.`);
    }
}

/**
 * Keeps ticket-open routing authoritative even while legacy ticket code is
 * being replaced. Newly-created ticket channels get the correct staff access
 * and the correct notification immediately when Discord emits channelCreate.
 */
export function registerTicketArtworkConsistency(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        const ticketChannel = channel as TextChannel;
        const metadata = decodeTicketMetadata(ticketChannel.topic);
        if (!metadata?.type) return;
        if (!['general', 'internal', 'management', 'highrank'].includes(metadata.type)) return;

        void configureOpenedTicket(ticketChannel, metadata.type).catch(error => {
            logger.error(`[TicketRouting] Failed to configure opened ${metadata.type} ticket ${ticketChannel.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
    });

    logger.info('[TicketRouting] Ticket-open pings active: General=@everyone, IA=1546570946322632865, High Rank=live High Rank role.');
}
