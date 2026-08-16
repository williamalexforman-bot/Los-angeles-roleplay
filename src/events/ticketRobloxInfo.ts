import {
    ChannelType,
    Client,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type Message,
} from 'discord.js';
import { resolveDockRobloxProfile } from '../services/dockService';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();
const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const ROBLOX_LOGO = '<:roblox_logo:1530323847922848044>';
const PANEL_FIND_ATTEMPTS = 12;
const PANEL_FIND_DELAY_MS = 500;

interface TicketMetadata {
    ownerId?: string;
    panelMessageId?: string;
}

type RawComponent = {
    type?: number;
    components?: RawComponent[];
    custom_id?: string;
};

function decodeTicketMetadata(topic: string | null): TicketMetadata | null {
    if (!topic?.startsWith(TICKET_TOPIC_PREFIX)) return null;
    try {
        const decoded = Buffer.from(topic.slice(TICKET_TOPIC_PREFIX.length), 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded) as TicketMetadata;
        return parsed.ownerId && /^\d+$/.test(parsed.ownerId) ? parsed : null;
    } catch {
        return null;
    }
}

function robloxAccountBlock(
    ownerId: string,
    data: {
        discordUsername?: string | null;
        username?: string | null;
        displayName?: string | null;
        robloxId?: string | null;
        createdAt?: string | null;
        status: string;
    },
): string {
    const createdMs = data.createdAt ? Date.parse(data.createdAt) : Number.NaN;
    const created = Number.isFinite(createdMs)
        ? `<t:${Math.floor(createdMs / 1_000)}:F> • <t:${Math.floor(createdMs / 1_000)}:R>`
        : 'Unavailable';
    const profile = data.robloxId && /^\d+$/.test(data.robloxId)
        ? `https://www.roblox.com/users/${data.robloxId}/profile`
        : 'Unavailable';

    return [
        `### ${ROBLOX_LOGO} Roblox Account Information`,
        `> **Discord User:** <@${ownerId}>`,
        `> **Discord Username:** ${data.discordUsername ? `\`${data.discordUsername}\`` : 'Unavailable'}`,
        `> **Roblox Username:** ${data.username ? `\`${data.username}\`` : 'Unavailable'}`,
        `> **Display Name:** ${data.displayName ? `\`${data.displayName}\`` : 'Unavailable'}`,
        `> **Roblox User ID:** ${data.robloxId ? `\`${data.robloxId}\`` : 'Unavailable'}`,
        `> **Account Created:** ${created}`,
        `> **Verification:** ${data.status}`,
        `> **Profile:** ${profile}`,
    ].join('\n');
}

async function findTicketPanelMessage(client: Client, channelId: string, metadata: TicketMetadata): Promise<Message | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;

    const currentMetadata = decodeTicketMetadata(channel.topic) || metadata;
    if (currentMetadata.panelMessageId) {
        const linked = await channel.messages.fetch(currentMetadata.panelMessageId).catch(() => null);
        if (linked) return linked;
    }

    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!recent || !client.user) return null;
    return recent.find(message =>
        message.author.id === client.user!.id
        && message.flags.has(MessageFlags.IsComponentsV2)
        && message.components.length > 0
    ) || null;
}

async function waitForTicketPanelMessage(client: Client, channelId: string, metadata: TicketMetadata): Promise<Message | null> {
    for (let attempt = 0; attempt < PANEL_FIND_ATTEMPTS; attempt += 1) {
        const message = await findTicketPanelMessage(client, channelId, metadata);
        if (message) return message;
        await new Promise(resolve => setTimeout(resolve, PANEL_FIND_DELAY_MS));
    }
    return null;
}

async function insertRobloxInfoIntoTicket(
    client: Client,
    channelId: string,
    guildId: string,
    metadata: TicketMetadata,
): Promise<void> {
    if (!metadata.ownerId) return;

    const message = await waitForTicketPanelMessage(client, channelId, metadata);
    if (!message) {
        logger.warn(`[Tickets] Opening V2 panel was not found for ticket ${channelId}; Roblox info was not merged.`);
        return;
    }

    const [lookup, discordUser] = await Promise.all([
        resolveDockRobloxProfile(guildId, metadata.ownerId, { timeoutMs: 5_000 }),
        client.users.fetch(metadata.ownerId).catch(() => null),
    ]);
    const discordUsername = discordUser?.username || null;
    const block = lookup.ok
        ? robloxAccountBlock(metadata.ownerId, {
            discordUsername,
            username: lookup.profile.username,
            displayName: lookup.profile.displayName,
            robloxId: lookup.profile.robloxId,
            createdAt: lookup.profile.createdAt,
            status: '✅ Dock Verified',
        })
        : robloxAccountBlock(metadata.ownerId, {
            discordUsername,
            status: lookup.status === 'not_verified'
                ? '⚠️ No Dock-verified Roblox account is linked.'
                : lookup.status === 'not_configured'
                    ? '⚠️ Dock verification is not configured.'
                    : '⚠️ Roblox information is temporarily unavailable.',
        });

    const roots = message.components.map(component => component.toJSON()) as unknown as RawComponent[];
    const container = roots.find(root => Array.isArray(root.components));
    if (!container?.components) return;

    const serialized = JSON.stringify(container);
    if (serialized.includes('Roblox Account Information')) return;

    const accountDisplay = new TextDisplayBuilder().setContent(block).toJSON() as unknown as RawComponent;
    const accountSeparator = new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
        .toJSON() as unknown as RawComponent;

    const actionIndex = container.components.findIndex(component => component.type === 1);
    const insertAt = actionIndex >= 0 ? actionIndex : Math.max(0, container.components.length - 2);
    container.components.splice(insertAt, 0, accountSeparator, accountDisplay);

    // Do not replace or resend attachments here. The original ticket message
    // already owns the assistance banner and underbanner; omitting attachments
    // preserves those attachment:// references while we only update V2 content.
    await message.edit({
        components: roots as never,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

export function registerTicketRobloxInfo(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        const metadata = decodeTicketMetadata(channel.topic);
        if (!metadata?.ownerId) return;
        void insertRobloxInfoIntoTicket(client, channel.id, channel.guild.id, metadata).catch(error => {
            logger.warn(`[Tickets] Roblox info could not be merged for ${metadata.ownerId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
}
