import {
    AttachmentBuilder,
    ChannelType,
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';
import { resolveDockRobloxProfile } from '../services/dockService';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();
const TICKET_TOPIC_PREFIX = 'larp-ticket:';

interface TicketMetadata {
    ownerId?: string;
}

function decodeTicketOwner(topic: string | null): string | null {
    if (!topic?.startsWith(TICKET_TOPIC_PREFIX)) return null;
    try {
        const decoded = Buffer.from(topic.slice(TICKET_TOPIC_PREFIX.length), 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded) as TicketMetadata;
        return parsed.ownerId && /^\d+$/.test(parsed.ownerId) ? parsed.ownerId : null;
    } catch {
        return null;
    }
}

function underbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(BOTTOM_UNDERBANNER),
    );
}

function robloxPanel(lines: readonly string[], color = 0x3b82f6): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(['## 🎮 Roblox Account Information', ...lines].join('\n')),
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addMediaGalleryComponents(underbanner());
}

async function postTicketRobloxInfo(client: Client, channelId: string, guildId: string, ownerId: string): Promise<void> {
    // Give the normal ticket opening panel time to post first so Roblox details
    // appear directly beneath the ticket's main information.
    await new Promise(resolve => setTimeout(resolve, 1_200));
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) return;

    const lookup = await resolveDockRobloxProfile(guildId, ownerId, { timeoutMs: 3_000 });
    const files = [new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.webp' })];

    if (!lookup.ok) {
        const status = lookup.status === 'not_verified'
            ? 'No Dock-verified Roblox account is linked to this Discord user.'
            : lookup.status === 'not_configured'
                ? 'Dock verification is not configured on this bot.'
                : 'Roblox information could not be loaded from Dock right now.';
        await channel.send({
            components: [robloxPanel([
                `**Discord User:** <@${ownerId}>`,
                `**Verification:** ⚠️ ${status}`,
            ], 0xf59e0b)],
            files,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
        return;
    }

    const profile = lookup.profile;
    await channel.send({
        components: [robloxPanel([
            `**Discord User:** <@${ownerId}>`,
            `**Username:** ${profile.username ? `\`${profile.username}\`` : 'Unavailable'}`,
            `**Display Name:** ${profile.displayName ? `\`${profile.displayName}\`` : 'Unavailable'}`,
            `**Roblox User ID:** \`${profile.robloxId}\``,
            '**Verification:** ✅ Dock Verified',
            `**Profile:** https://www.roblox.com/users/${profile.robloxId}/profile`,
        ])],
        files,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}

export function registerTicketRobloxInfo(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        const ownerId = decodeTicketOwner(channel.topic);
        if (!ownerId) return;
        void postTicketRobloxInfo(client, channel.id, channel.guild.id, ownerId).catch(error => {
            logger.warn(`[Tickets] Roblox info could not be posted for ${ownerId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
}
