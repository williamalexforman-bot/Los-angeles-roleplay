import { ChannelType, Client, type Message, type TextChannel } from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const registeredClients = new WeakSet<Client>();
const PANEL_FIND_ATTEMPTS = 16;
const PANEL_FIND_DELAY_MS = 400;

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
        if (headingIndex >= 0) {
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
    }
    return '';
}

async function waitForTicketPanel(channel: TextChannel, metadata: TicketMetadata): Promise<Message | null> {
    for (let attempt = 0; attempt < PANEL_FIND_ATTEMPTS; attempt += 1) {
        const current = decodeMetadata(channel.topic) || metadata;
        if (current.panelMessageId) {
            const linked = await channel.messages.fetch(current.panelMessageId).catch(() => null);
            if (linked) return linked;
        }
        const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
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
    const cleaned = value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
    return (cleaned || 'support-request').slice(0, 62).replace(/-+$/g, '');
}

function fallbackTitle(reason: string): string {
    const normalized = reason.toLowerCase();
    const known: Array<[RegExp, string]> = [
        [/\bban\s+appeal|appeal(?:ing)?\s+(?:a\s+)?ban\b/i, 'ban-appeal'],
        [/\bappeal\b/i, 'appeal-request'],
        [/\bpartner|partnership\b/i, 'partnership-request'],
        [/\bpaid\s*ad|advertis(?:e|ement|ing)\b/i, 'paid-ad-question'],
        [/\bhack(?:er|ing|ed)?|exploit(?:er|ing)?\b/i, 'hacker-report'],
        [/\braid(?:ing|er|ers)?\b/i, 'raid-threat'],
        [/\breport(?:ing)?\s+(?:a\s+)?staff|staff\s+report\b/i, 'staff-report'],
        [/\breport(?:ing)?\s+(?:a\s+)?player|player\s+report\b/i, 'player-report'],
        [/\bapplication\b/i, 'application-question'],
        [/\btransfer|fast\s*pass\b/i, 'staff-transfer'],
        [/\bperk|prize|payment\b/i, 'perk-or-prize-help'],
        [/\bhow\s+do\s+i|question|help\b/i, 'general-question'],
    ];
    for (const [pattern, title] of known) if (pattern.test(normalized)) return title;
    const words = normalized
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !['the', 'and', 'that', 'this', 'with', 'have', 'need', 'want', 'ticket', 'please', 'because', 'about'].includes(word))
        .slice(0, 5);
    return words.length ? words.join('-') : 'support-request';
}

function fallbackPriority(type: TicketType, reason: string): PriorityResult {
    const normalized = reason.toLowerCase();
    const activeEmergency = /\b(?:active|currently|right\s+now|happening|ongoing)\b/i.test(normalized);
    const raidOrHack = /\b(?:raid(?:ing|er|ers)?|hack(?:er|ing|ed)?|exploit(?:er|ing)?|doxx?(?:ing|ed)?)\b/i.test(normalized);

    if (raidOrHack && (activeEmergency || /\bthreat(?:en|ening)?\b/i.test(normalized))) {
        return { priority: 'emergency', title: fallbackTitle(reason) };
    }
    if (/\b(?:raid\s*threat|mass\s*raid|server\s*raid|hacker|hacking|exploiter|doxx?)\b/i.test(normalized)
        && !/\bappeal\b/i.test(normalized)) {
        return { priority: 'emergency', title: fallbackTitle(reason) };
    }
    if (/\b(?:urgent|threat|blackmail|compromised|stolen\s+account|serious\s+staff\s+misconduct)\b/i.test(normalized)) {
        return { priority: 'high', title: fallbackTitle(reason) };
    }
    if (type === 'internal' || /\b(?:report|complaint|partnership|paid\s*ad|payment|purchase|transfer|fast\s*pass)\b/i.test(normalized)) {
        return { priority: 'medium', title: fallbackTitle(reason) };
    }
    return { priority: 'low', title: fallbackTitle(reason) };
}

async function aiPriority(type: TicketType, reason: string): Promise<PriorityResult> {
    const fallback = fallbackPriority(type, reason);
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return fallback;

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.TICKET_TRIAGE_MODEL?.trim() || process.env.TICKET_RECAP_MODEL?.trim() || 'gpt-5-mini',
                input: [
                    {
                        role: 'system',
                        content: [
                            'Classify the priority of a Discord support ticket and make a short channel title.',
                            'Return exactly: priority|short-title',
                            'priority must be one of low, medium, high, emergency.',
                            'low: appeals, ordinary questions, simple help, application questions.',
                            'medium: normal reports, partnership/business requests, payment or transfer issues that are not urgent.',
                            'high: serious or time-sensitive issues, credible threats, major staff misconduct, compromised accounts.',
                            'emergency: active raid threats, active raids, hackers/exploiters actively attacking the server, doxxing/security emergencies.',
                            'The short title must summarize the issue in 2-5 words, lowercase, letters/numbers/hyphens only.',
                            'Do not copy a long user sentence and do not include usernames, IDs, links, or private details.',
                        ].join(' '),
                    },
                    { role: 'user', content: `Ticket category: ${type}\nOpening reason: ${reason.slice(0, 3000)}` },
                ],
                max_output_tokens: 40,
            }),
            signal: AbortSignal.timeout(7000),
        });
        if (!response.ok) return fallback;
        const payload = await response.json() as { output_text?: unknown };
        const raw = typeof payload.output_text === 'string' ? payload.output_text.trim() : '';
        const [priorityRaw, titleRaw] = raw.split('|', 2).map(part => part.trim().toLowerCase());
        if (!['low', 'medium', 'high', 'emergency'].includes(priorityRaw) || !titleRaw) return fallback;
        return { priority: priorityRaw as Priority, title: shortSlug(titleRaw) };
    } catch {
        return fallback;
    }
}

function channelName(result: PriorityResult): string {
    const emoji: Record<Priority, string> = {
        low: '🟢',
        medium: '🟠',
        high: '🔴',
        emergency: '🆘',
    };
    return `${emoji[result.priority]}-${shortSlug(result.title)}`.slice(0, 90);
}

async function prioritizeTicket(channel: TextChannel, metadata: TicketMetadata): Promise<void> {
    const panel = await waitForTicketPanel(channel, metadata);
    if (!panel) {
        logger.warn(`[Ticket Priority] Could not find opening panel for ${channel.id}.`);
        return;
    }
    const reason = openingReasonFromPanel(panel, metadata.type);
    if (!reason) return;

    if (duckNeeded(reason)) {
        await channel.setName('🐥-duck-needed', 'Ticket opening reason specifically requests Duck.').catch(error => {
            logger.warn(`[Ticket Priority] Could not apply Duck-needed name to ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
        logger.info(`[Ticket Priority] ${channel.id} renamed to Duck needed.`);
        return;
    }

    const result = await aiPriority(metadata.type, reason);
    const name = channelName(result);
    await channel.setName(name, `Ticket priority classified as ${result.priority}.`).catch(error => {
        logger.warn(`[Ticket Priority] Could not rename ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    logger.info(`[Ticket Priority] ${channel.id} classified ${result.priority} as ${name}.`);
}

export function registerTicketPriority(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        const metadata = decodeMetadata(channel.topic);
        if (!metadata) return;
        void prioritizeTicket(channel, metadata).catch(error => {
            logger.warn(`[Ticket Priority] Classification failed for ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    logger.info('[Ticket Priority] AI priority naming enabled for new tickets.');
}
