import { resolve } from 'path';
import {
    AttachmentBuilder,
    ChannelType,
    Client,
    Events,
    MessageFlags,
    type Message,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const registeredClients = new WeakSet<Client>();

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function isTicketPanel(message: Message): boolean {
    const visit = (node: Record<string, unknown>): boolean => {
        if (node.custom_id === 'ticket:claim') return true;
        const children = node.components as Array<Record<string, unknown>> | undefined;
        return Boolean(children?.some(visit));
    };
    return message.components.some(component => visit(component.toJSON() as unknown as Record<string, unknown>));
}

function normalizedComponents(message: Message): unknown[] | null {
    const components = message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    const galleries = components.filter(component => component.type === 12);
    if (!galleries.length) return null;

    const setGalleryMedia = (gallery: Record<string, unknown>, filename: string): void => {
        const items = gallery.items as Array<Record<string, unknown>> | undefined;
        if (!items?.length) return;
        const media = items[0].media as Record<string, unknown> | undefined;
        if (!media) return;
        media.url = `attachment://${filename}`;
    };

    setGalleryMedia(galleries[0], ASSISTANCE_BANNER_NAME);
    if (galleries.length > 1) setGalleryMedia(galleries[galleries.length - 1], UNDERBANNER_NAME);
    return components;
}

async function findOpeningPanel(channel: TextChannel): Promise<Message | null> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        const panel = recent?.find(message => message.author.id === channel.client.user.id && isTicketPanel(message));
        if (panel) return panel;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
    return null;
}

async function normalizeTicketArtwork(channel: TextChannel): Promise<void> {
    // The channel is created before the ticket creator finishes its first
    // message. Wait until the managed-ticket topic and opening panel exist.
    for (let attempt = 0; attempt < 24; attempt += 1) {
        if (channel.topic?.startsWith(TICKET_TOPIC_PREFIX)) break;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
        const refreshed = await channel.fetch().catch(() => null);
        if (refreshed?.type === ChannelType.GuildText) channel = refreshed;
    }
    if (!channel.topic?.startsWith(TICKET_TOPIC_PREFIX)) return;

    const panel = await findOpeningPanel(channel);
    if (!panel) {
        logger.warn(`[TicketArtwork] Could not find the opening ticket panel in ${channel.id}.`);
        return;
    }

    const components = normalizedComponents(panel);
    if (!components) return;

    try {
        await panel.edit({
            components: components as never,
            files: artwork(),
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
        });
        logger.info(`[TicketArtwork] Normalized Assistance artwork in ${channel.id}.`);
    } catch (error) {
        logger.warn(`[TicketArtwork] Could not normalize ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function registerTicketArtworkConsistency(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.ChannelCreate, channel => {
        if (channel.type !== ChannelType.GuildText) return;
        void normalizeTicketArtwork(channel);
    });

    logger.info('[TicketArtwork] All new managed tickets will use the current Assistance banner and underbanner.');
}
