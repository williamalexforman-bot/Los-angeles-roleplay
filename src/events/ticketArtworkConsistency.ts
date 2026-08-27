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
const completedChannels = new Set<string>();

type TicketType = 'general' | 'internal' | 'management' | 'highrank';
type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

type RawComponent = {
    type?: number;
    content?: unknown;
    custom_id?: unknown;
    components?: RawComponent[];
    items?: Array<{ media?: { url?: string } }>;
};

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith(TICKET_TOPIC_PREFIX)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice(TICKET_TOPIC_PREFIX.length), 'base64url').toString('utf8')) as TicketMetadata;
        if (!parsed?.ownerId || !['general', 'internal', 'management', 'highrank'].includes(parsed.type)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function isTicketPanel(message: Message): boolean {
    const visit = (node: RawComponent): boolean => {
        if (node.custom_id === 'ticket:claim') return true;
        return Boolean(node.components?.some(visit));
    };
    return message.components.some(component => visit(component.toJSON() as unknown as RawComponent));
}

function allText(message: Message): string {
    const chunks: string[] = [];
    const visit = (node: RawComponent): void => {
        if (typeof node.content === 'string') chunks.push(node.content);
        node.components?.forEach(visit);
    };
    message.components.forEach(component => visit(component.toJSON() as unknown as RawComponent));
    return chunks.join('\n');
}

function field(text: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, 'iu'));
    return match?.[1]?.trim() || '';
}

function openingReason(text: string): string {
    const inquiry = text.match(/\*\*Inquiry:\*\*\s*\n([\s\S]*?)(?=\n\*\*[^\n*]+:\*\*|$)/iu)?.[1]?.trim();
    if (inquiry) return inquiry;
    const inline = text.match(/\*\*(?:Reason for Opening Ticket|Reason for Report):\*\*\s*([^\n]+)/iu)?.[1]?.trim();
    if (inline) return inline;
    const heading = text.match(/###\s+(?:Reason for Opening Ticket|Reason for Report)\s*\n(?:```)?\s*([\s\S]*?)(?:```|\n###|$)/iu)?.[1]?.trim();
    return heading || 'No reason provided.';
}

function extraTicketInfo(text: string): string[] {
    const reserved = new Set([
        'Ticket ID', 'Date Opened', 'Member', 'Claimed By', 'Joined Server',
        'Inquiry', 'Roblox Id', 'Roblox Name',
    ]);
    const extras: string[] = [];
    const pattern = /\*\*([^\n*]+):\*\*\s*([^\n]+)/gu;
    for (const match of text.matchAll(pattern)) {
        const label = match[1].trim();
        const value = match[2].trim();
        if (reserved.has(label) || !value) continue;
        extras.push(`**${label}:** ${value}`);
    }
    return extras;
}

function categoryLabel(type: TicketType): string {
    if (type === 'internal') return '📋 Internal Affairs Support';
    if (type === 'management') return '🏛️ Management Support';
    if (type === 'highrank') return '⭐ Directorship / Ownership';
    return '🎫 General Support';
}

function cleanReason(reason: string): string {
    return reason
        .replace(/```/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 1_100) || 'No reason provided.';
}

function polishedText(message: Message, metadata: TicketMetadata): string {
    const text = allText(message);
    const reason = cleanReason(openingReason(text));
    const ticketId = field(text, 'Ticket ID') || message.channelId.slice(-6);
    const opened = field(text, 'Date Opened') || `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`;
    const member = field(text, 'Member') || `<@${metadata.ownerId}>`;
    const claimed = metadata.claimedBy ? `<@${metadata.claimedBy}>` : 'Unclaimed';
    const joined = field(text, 'Joined Server') || 'Unavailable';
    const extras = extraTicketInfo(text);

    return [
        `<@${metadata.ownerId}>`,
        '',
        '## 🛟 Assistance',
        `### ${categoryLabel(metadata.type)}`,
        'Thanks for contacting **Los Angeles Roleplay Support**. A staff member will assist you as soon as possible.',
        '',
        '### 📌 Reason for Opening',
        `> ${reason.replace(/\n/gu, '\n> ')}`,
        '',
        ...(extras.length ? ['### 📝 Additional Information', ...extras, ''] : []),
        '### 🎟️ Ticket Details',
        `**Member:** ${member}`,
        `**Claimed By:** ${claimed}`,
        `**Ticket ID:** ${ticketId}`,
        `**Opened:** ${opened}`,
        `**Joined Server:** ${joined}`,
        '',
        '*Use the buttons below to claim, close, or escalate this ticket.*',
    ].join('\n').slice(0, 4_000);
}

function normalizedComponents(message: Message, metadata: TicketMetadata): unknown[] | null {
    const components = message.components.map(component => component.toJSON()) as unknown as RawComponent[];
    let mainTextReplaced = false;
    const galleries: RawComponent[] = [];

    const visit = (node: RawComponent): void => {
        if (node.type === 12 && Array.isArray(node.items)) galleries.push(node);
        if (!mainTextReplaced && typeof node.content === 'string' && node.content.includes('Assistance')) {
            node.content = polishedText(message, metadata);
            mainTextReplaced = true;
        }
        node.components?.forEach(visit);
    };
    components.forEach(visit);

    if (!mainTextReplaced) {
        const textNode = (() => {
            let found: RawComponent | null = null;
            const find = (node: RawComponent): void => {
                if (!found && typeof node.content === 'string') found = node;
                node.components?.forEach(find);
            };
            components.forEach(find);
            return found;
        })();
        if (textNode) textNode.content = polishedText(message, metadata);
    }

    const setGalleryMedia = (gallery: RawComponent, filename: string): void => {
        if (!gallery.items?.length || !gallery.items[0].media) return;
        gallery.items[0].media.url = `attachment://${filename}`;
    };
    if (galleries.length) {
        setGalleryMedia(galleries[0], ASSISTANCE_BANNER_NAME);
        if (galleries.length > 1) setGalleryMedia(galleries[galleries.length - 1], UNDERBANNER_NAME);
    }
    return components;
}

function shortSlug(value: string): string {
    const words = value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/https?:\/\/\S+/gu, '')
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .filter(word => !new Set([
            'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'my', 'me', 'i', 'is', 'it',
            'this', 'that', 'please', 'ticket', 'need', 'want', 'help', 'with', 'about', 'because',
        ]).has(word))
        .slice(0, 4);
    return (words.length ? words.join('-') : 'support').slice(0, 34).replace(/-+$/gu, '') || 'support';
}

function ticketName(type: TicketType, reason: string): string {
    const lower = reason.toLowerCase();
    let priority = type === 'highrank' ? '🔴' : (type === 'management' || type === 'internal' ? '🟠' : '🟢');
    if (/\b(?:active|ongoing|right now|happening|raid|doxx|hacker|exploit|emergency)\b/iu.test(lower)) priority = '🆘';
    else if (/\b(?:urgent|threat|blackmail|compromised|serious misconduct)\b/iu.test(lower)) priority = '🔴';

    let title = shortSlug(reason);
    const known: Array<[RegExp, string]> = [
        [/\bpartnership|partner\b/iu, 'partnership-request'],
        [/\bretir(?:e|ement|ing)|resign(?:ation|ing)?|step(?:ping)? down\b/iu, 'retirement-request'],
        [/\breport.*staff|staff.*report|staff complaint\b/iu, 'staff-report'],
        [/\breport.*player|player.*report\b/iu, 'player-report'],
        [/\bban appeal|appeal.*ban\b/iu, 'ban-appeal'],
        [/\bmarketplace|payment|purchase\b/iu, 'marketplace-help'],
        [/\btransfer\b/iu, 'staff-transfer'],
        [/\bowner|ownership\b/iu, 'ownership-needed'],
    ];
    for (const [pattern, replacement] of known) {
        if (pattern.test(lower)) {
            title = replacement;
            break;
        }
    }
    return `${priority}-${title}`.slice(0, 90);
}

async function findOpeningPanel(channel: TextChannel): Promise<Message | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        const panel = recent?.find(message => message.author.id === channel.client.user.id && isTicketPanel(message));
        if (panel) return panel;
        if (attempt < 7) await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
    }
    return null;
}

async function waitForMetadata(channel: TextChannel): Promise<TicketMetadata | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const metadata = decodeMetadata(channel.topic);
        if (metadata) return metadata;
        if (attempt < 7) {
            await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
            const refreshed = await channel.fetch().catch(() => null);
            if (refreshed?.type === ChannelType.GuildText) channel = refreshed;
        }
    }
    return null;
}

async function polishTicket(channel: TextChannel): Promise<void> {
    if (completedChannels.has(channel.id)) return;
    const metadata = await waitForMetadata(channel);
    if (!metadata) return;
    const panel = await findOpeningPanel(channel);
    if (!panel) {
        logger.warn(`[TicketPresentation] Could not find the opening ticket panel in ${channel.id}.`);
        return;
    }

    const originalText = allText(panel);
    const reason = cleanReason(openingReason(originalText));
    const components = normalizedComponents(panel, metadata);
    if (!components) return;

    try {
        await Promise.all([
            panel.edit({
                components: components as never,
                files: artwork(),
                attachments: [],
                flags: MessageFlags.IsComponentsV2,
            }),
            channel.setName(ticketName(metadata.type, reason), 'Immediate ticket reason/priority naming.'),
        ]);
        completedChannels.add(channel.id);
        logger.info(`[TicketPresentation] Polished and renamed ${channel.id} immediately.`);
    } catch (error) {
        logger.warn(`[TicketPresentation] Could not polish ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function registerTicketArtworkConsistency(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.ChannelCreate, channel => {
        if (channel.type !== ChannelType.GuildText) return;
        void polishTicket(channel);
    });

    client.on(Events.MessageCreate, message => {
        if (message.author.id !== client.user?.id || message.channel.type !== ChannelType.GuildText) return;
        if (!isTicketPanel(message)) return;
        void polishTicket(message.channel);
    });

    client.on(Events.ChannelDelete, channel => {
        completedChannels.delete(channel.id);
    });

    logger.info('[TicketPresentation] New tickets use the current Assistance artwork, a reason-first layout, no Roblox fields, and immediate naming.');
}
