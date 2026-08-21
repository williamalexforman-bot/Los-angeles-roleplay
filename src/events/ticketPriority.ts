import { ChannelType, Client, type Message, type TextChannel } from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const registeredClients = new WeakSet<Client>();
const processingChannels = new Set<string>();
const completedChannels = new Set<string>();
const PANEL_FIND_ATTEMPTS = 24;
const PANEL_FIND_DELAY_MS = 350;
const METADATA_FIND_ATTEMPTS = 20;
const METADATA_FIND_DELAY_MS = 250;
const MAX_TITLE_WORDS = 4;
const MAX_TITLE_LENGTH = 34;

type TicketType = 'general' | 'internal' | 'management' | 'highrank';
type Priority = 'low' | 'medium' | 'high' | 'emergency';

type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

type RawComponent = {
    content?: unknown;
    components?: RawComponent[];
};

type PriorityResult = {
    priority: Priority;
    title: string;
};

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith(TICKET_TOPIC_PREFIX)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice(TICKET_TOPIC_PREFIX.length), 'base64url').toString('utf8')) as TicketMetadata;
        if (!parsed.ownerId || !['general', 'internal', 'management', 'highrank'].includes(parsed.type)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function componentText(message: Message): string {
    const output: string[] = [];
    const visit = (node: RawComponent): void => {
        if (typeof node.content === 'string') output.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as RawComponent);
    return output.join('\n');
}

function openingReasonFromPanel(message: Message, type: TicketType): string {
    const lines = componentText(message).split(/\r?\n/);
    const labels = type === 'internal'
        ? ['Reason for Report']
        : ['Reason for Opening Ticket', 'Reason for Report'];

    for (const label of labels) {
        const headingIndex = lines.findIndex(line => line.trim().toLowerCase() === `### ${label}`.toLowerCase());
        if (headingIndex < 0) continue;

        const collected: string[] = [];
        for (let index = headingIndex + 1; index < lines.length; index += 1) {
            const line = lines[index].trim();
            if (!line || line === '```') continue;
            if (line.startsWith('### ')) break;
            collected.push(line);
        }
        const reason = collected.join(' ').trim();
        if (reason) return reason;
    }
    return '';
}

async function waitForMetadata(channel: TextChannel): Promise<TicketMetadata | null> {
    for (let attempt = 0; attempt < METADATA_FIND_ATTEMPTS; attempt += 1) {
        const metadata = decodeMetadata(channel.topic);
        if (metadata) return metadata;
        if (attempt < METADATA_FIND_ATTEMPTS - 1) {
            await new Promise(resolveDelay => setTimeout(resolveDelay, METADATA_FIND_DELAY_MS));
            const refreshed = await channel.fetch().catch(() => null);
            if (refreshed?.type === ChannelType.GuildText) channel = refreshed;
        }
    }
    return null;
}

async function waitForTicketPanel(channel: TextChannel, metadata: TicketMetadata): Promise<Message | null> {
    for (let attempt = 0; attempt < PANEL_FIND_ATTEMPTS; attempt += 1) {
        const current = decodeMetadata(channel.topic) || metadata;
        if (current.panelMessageId) {
            const linked = await channel.messages.fetch(current.panelMessageId).catch(() => null);
            if (linked) return linked;
        }

        const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        const panel = recent?.find(message =>
            message.author.id === channel.client.user?.id
            && componentText(message).includes('Ticket'),
        );
        if (panel) return panel;
        await new Promise(resolveDelay => setTimeout(resolveDelay, PANEL_FIND_DELAY_MS));
    }
    return null;
}

function duckNeeded(reason: string): boolean {
    return /\b(?:i\s+need|need|needed|looking\s+for|speak\s+to|talk\s+to|contact|get|want)\s+(?:mr\.?\s*)?duck\b|\b(?:mr\.?\s*)?duck\s+(?:needed|required|please)\b/i.test(reason);
}

function shortSlug(value: string): string {
    const words = value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .filter(word => ![
            'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'my', 'me', 'i', 'is', 'it',
            'this', 'that', 'please', 'ticket', 'need', 'want', 'help', 'with', 'about', 'because',
        ].includes(word))
        .slice(0, MAX_TITLE_WORDS);
    const slug = (words.length ? words : ['support']).join('-');
    return slug.slice(0, MAX_TITLE_LENGTH).replace(/-+$/g, '') || 'support';
}

function titleForReason(type: TicketType, reason: string): string {
    const normalized = reason.toLowerCase();
    const known: Array<[RegExp, string]> = [
        [/\bban\s+appeal|appeal(?:ing)?\s+(?:a\s+)?ban\b/i, 'ban-appeal'],
        [/\bwarn(?:ing)?\s+appeal|appeal.*warn/i, 'warning-appeal'],
        [/\bstrike\s+appeal|appeal.*strike/i, 'strike-appeal'],
        [/\bsuspension\s+appeal|appeal.*suspension/i, 'suspension-appeal'],
        [/\bdemotion\s+appeal|appeal.*demotion/i, 'demotion-appeal'],
        [/\binfraction\s+appeal|appeal.*infraction/i, 'infraction-appeal'],
        [/\bappeal\b/i, 'appeal-request'],
        [/\bpartner|partnership\b/i, 'partnership-request'],
        [/\bpaid\s*ad|advertis(?:e|ement|ing)\b/i, 'paid-ad-help'],
        [/\bhack(?:er|ing|ed)?|exploit(?:er|ing)?\b/i, 'hacker-report'],
        [/\braid(?:ing|er|ers)?\b/i, 'raid-threat'],
        [/\bdoxx?|leak(?:ed|ing)?\s+(?:info|information)\b/i, 'security-threat'],
        [/\breport(?:ing)?\s+(?:a\s+)?staff|staff\s+report|staff\s+complaint\b/i, 'staff-report'],
        [/\breport(?:ing)?\s+(?:a\s+)?player|player\s+report\b/i, 'player-report'],
        [/\bapplication\b/i, 'application-question'],
        [/\btransfer\b/i, 'staff-transfer'],
        [/\bfast\s*pass\b/i, 'fast-pass-help'],
        [/\bperk\b/i, 'perk-help'],
        [/\bprize\b/i, 'prize-claim'],
        [/\bpayment|purchase\b/i, 'payment-help'],
        [/\bmarketplace\b/i, 'marketplace-help'],
        [/\bownership|owner\b/i, 'ownership-question'],
        [/\brole\b.*\bmissing|missing.*\brole\b/i, 'missing-role'],
    ];

    for (const [pattern, title] of known) {
        if (pattern.test(normalized)) return title;
    }

    const categoryFallback: Record<TicketType, string> = {
        general: 'general-support',
        internal: 'internal-affairs',
        management: 'management-support',
        highrank: 'high-rank-support',
    };

    // Only use the user's wording when it contains enough useful content.
    const slug = shortSlug(reason);
    return slug && slug !== 'support' ? slug : categoryFallback[type];
}

function classifyTicket(type: TicketType, reason: string): PriorityResult {
    const normalized = reason.toLowerCase();
    const title = titleForReason(type, reason);

    const activeEmergency = /\b(?:active|currently|right\s+now|happening|ongoing|in\s+progress)\b/i.test(normalized);
    const attackLanguage = /\b(?:raid(?:ing|er|ers)?|hack(?:er|ing|ed)?|exploit(?:er|ing)?|doxx?(?:ing|ed)?)\b/i.test(normalized);
    if (attackLanguage && (activeEmergency || /\b(?:threat|attack|attacking)\b/i.test(normalized))) {
        return { priority: 'emergency', title };
    }
    if (/\b(?:raid\s*threat|mass\s*raid|server\s*raid|doxx?|active\s+hacker|active\s+exploiter)\b/i.test(normalized)
        && !/\bappeal\b/i.test(normalized)) {
        return { priority: 'emergency', title };
    }
    if (/\b(?:urgent|credible\s+threat|blackmail|compromised|stolen\s+account|serious\s+staff\s+misconduct)\b/i.test(normalized)) {
        return { priority: 'high', title };
    }

    // Category floors stop nearly every ticket from becoming green.
    if (type === 'highrank') return { priority: 'high', title };
    if (type === 'management' || type === 'internal') return { priority: 'medium', title };

    if (/\b(?:report|complaint|partnership|paid\s*ad|payment|purchase|transfer|fast\s*pass|marketplace)\b/i.test(normalized)) {
        return { priority: 'medium', title };
    }

    return { priority: 'low', title };
}

function channelName(result: PriorityResult): string {
    const emoji: Record<Priority, string> = {
        low: '🟢',
        medium: '🟠',
        high: '🔴',
        emergency: '🆘',
    };
    return `${emoji[result.priority]}-${shortSlug(result.title)}`;
}

async function prioritizeTicket(channel: TextChannel, suppliedMetadata?: TicketMetadata): Promise<boolean> {
    if (completedChannels.has(channel.id)) return true;
    if (processingChannels.has(channel.id)) return false;
    processingChannels.add(channel.id);

    try {
        const metadata = suppliedMetadata || await waitForMetadata(channel);
        if (!metadata) {
            logger.warn(`[Ticket Priority] Metadata never became available for ${channel.id}.`);
            return false;
        }

        const panel = await waitForTicketPanel(channel, metadata);
        if (!panel) {
            logger.warn(`[Ticket Priority] Could not find opening panel for ${channel.id}.`);
            return false;
        }

        const reason = openingReasonFromPanel(panel, metadata.type);
        if (!reason) {
            logger.warn(`[Ticket Priority] Opening reason could not be read for ${channel.id}.`);
            return false;
        }

        const name = duckNeeded(reason)
            ? '🐥-duck-needed'
            : channelName(classifyTicket(metadata.type, reason));

        const renamed = await channel.setName(name, 'Deterministic ticket category, priority, and reason naming.')
            .then(() => true)
            .catch(error => {
                logger.warn(`[Ticket Priority] Could not rename ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return false;
            });
        if (!renamed) return false;

        completedChannels.add(channel.id);
        logger.info(`[Ticket Priority] ${channel.id} renamed to ${name}.`);
        return true;
    } finally {
        processingChannels.delete(channel.id);
    }
}

async function attemptTicketPriority(channel: TextChannel): Promise<void> {
    if (completedChannels.has(channel.id)) return;
    const metadata = await waitForMetadata(channel);
    if (!metadata) return;
    await prioritizeTicket(channel, metadata);
}

export function registerTicketPriority(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        void attemptTicketPriority(channel).catch(error => {
            logger.warn(`[Ticket Priority] Channel-create classification failed for ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    client.on('messageCreate', message => {
        if (message.author.id !== client.user?.id || message.channel.type !== ChannelType.GuildText) return;
        if (completedChannels.has(message.channel.id)) return;
        if (!componentText(message).includes('Ticket')) return;
        void attemptTicketPriority(message.channel).catch(error => {
            logger.warn(`[Ticket Priority] Opening-panel fallback failed for ${message.channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    logger.info('[Ticket Priority] Single authoritative deterministic ticket naming enabled.');
}
