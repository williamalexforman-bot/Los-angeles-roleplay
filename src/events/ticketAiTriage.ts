import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const PANEL_FIND_ATTEMPTS = 16;
const PANEL_FIND_DELAY_MS = 400;
const PARTNERSHIP_UNDERBANNER_NAME = 'underbanner.webp';
const PARTNERSHIP_UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', PARTNERSHIP_UNDERBANNER_NAME);
const registeredClients = new WeakSet<Client>();

type TicketType = 'general' | 'internal' | 'management' | 'highrank';

type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

type TriageDecision = 'report' | 'partnership' | 'paid_ad' | 'no_action';

type RawComponent = {
    content?: unknown;
    components?: RawComponent[];
};

const PARTNERSHIP_PANEL_TEXT = [
    'Thank you for choosing to partner with LARP!',
    '',
    'We have a few rules about partnering with us:',
    '- You must stay in the server the whole time; leaving will delete your partnership.',
    '- You must post our partnership in your server; deleting it from your server will result in an **INSTANT deletion**.',
    '',
    'Perks of partnering with us:',
    '- Gain the partnership role.',
    '- Show everyone that you are a proud partner of LARP!',
    '',
    'Please wait as we review your request.',
].join('\n');

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

        const inlinePrefix = `**${label}:**`;
        const inline = lines.find(line => line.trim().toLowerCase().startsWith(inlinePrefix.toLowerCase()));
        if (inline) {
            const value = inline.trim().slice(inlinePrefix.length).trim();
            if (value) return value;
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
            && message.flags.has(MessageFlags.IsComponentsV2)
            && componentText(message).includes('Ticket'),
        );
        if (panel) return panel;
        await new Promise(resolveDelay => setTimeout(resolveDelay, PANEL_FIND_DELAY_MS));
    }
    return null;
}

function hardReportRule(type: TicketType, reason: string): boolean {
    if (type === 'internal') return true;
    const normalized = reason.toLowerCase();
    return /\b(report|reporting|reported|staff report|player report|complaint against|report a)\b/i.test(normalized);
}

function fallbackDecision(reason: string): TriageDecision {
    const normalized = reason.toLowerCase();
    if (/\b(partner|partnership|partnering|become a partner)\b/i.test(normalized)) return 'partnership';
    if (/\b(paid\s*ad|paid\s*advert|advertisement|advertising|buy\s+an?\s+ad|purchase\s+an?\s+ad)\b/i.test(normalized)) return 'paid_ad';
    return 'no_action';
}

async function aiDecision(reason: string): Promise<TriageDecision> {
    const fallback = fallbackDecision(reason);
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey || !reason.trim()) return fallback;

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
                            'Classify a Discord support ticket opening reason.',
                            'Return exactly one label and nothing else: report, partnership, paid_ad, or no_action.',
                            'report = reporting a user/staff member, complaint/allegation, evidence against someone, misconduct report.',
                            'partnership = asking how to partner, requesting partnership, becoming a partner.',
                            'paid_ad = asking to buy, request, purchase, or learn about a paid advertisement.',
                            'no_action = anything else.',
                            'When uncertain, choose no_action.',
                        ].join(' '),
                    },
                    { role: 'user', content: reason.slice(0, 3_000) },
                ],
                max_output_tokens: 20,
            }),
            signal: AbortSignal.timeout(7_000),
        });
        if (!response.ok) return fallback;
        const payload = await response.json() as { output_text?: unknown };
        const label = typeof payload.output_text === 'string' ? payload.output_text.trim().toLowerCase() : '';
        if (label === 'report' || label === 'partnership' || label === 'paid_ad' || label === 'no_action') return label;
        return fallback;
    } catch {
        return fallback;
    }
}

function partnershipUnderbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${PARTNERSHIP_UNDERBANNER_NAME}`),
    );
}

function partnershipPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 🤝 Partnership Request\n${PARTNERSHIP_PANEL_TEXT}`),
        )
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('partnership:open')
                    .setLabel('Submit Partnership Request')
                    .setEmoji('🤝')
                    .setStyle(ButtonStyle.Primary),
            ),
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addMediaGalleryComponents(partnershipUnderbanner());
}

async function stillUnclaimed(channel: TextChannel): Promise<boolean> {
    const current = decodeMetadata(channel.topic);
    return Boolean(current && !current.claimedBy);
}

async function handleNewTicket(channel: TextChannel, metadata: TicketMetadata): Promise<void> {
    const panel = await waitForTicketPanel(channel, metadata);
    if (!panel) {
        logger.warn(`[Ticket AI] Could not find opening panel for ${channel.id}.`);
        return;
    }

    const reason = openingReasonFromPanel(panel, metadata.type);
    if (!reason) {
        logger.info(`[Ticket AI] No opening reason could be read for ${channel.id}; no automatic response sent.`);
        return;
    }

    // Reports are a hard no-response category. This check happens before any
    // external AI request, so a report can never be answered because of a
    // classifier mistake.
    if (hardReportRule(metadata.type, reason)) {
        logger.info(`[Ticket AI] ${channel.id} identified as a report; automatic response suppressed.`);
        return;
    }

    const decision = await aiDecision(reason);
    if (!(await stillUnclaimed(channel))) {
        logger.info(`[Ticket AI] ${channel.id} was claimed before triage finished; automatic response skipped.`);
        return;
    }

    if (decision === 'report') {
        logger.info(`[Ticket AI] ${channel.id} classified as a report; automatic response suppressed.`);
        return;
    }

    if (decision === 'paid_ad') {
        await channel.send({
            content: "As of now paid ad’s are not available please wait until they are.",
            allowedMentions: { parse: [] },
        });
        logger.info(`[Ticket AI] Paid-ad availability response sent in ${channel.id}.`);
        return;
    }

    if (decision === 'partnership') {
        await channel.send({
            components: [partnershipPanel()],
            files: [new AttachmentBuilder(PARTNERSHIP_UNDERBANNER_PATH, { name: PARTNERSHIP_UNDERBANNER_NAME })],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        logger.info(`[Ticket AI] Partnership request flow automatically posted in ${channel.id}.`);
    }
}

export function registerTicketAiTriage(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('channelCreate', channel => {
        if (channel.type !== ChannelType.GuildText) return;
        const metadata = decodeMetadata(channel.topic);
        if (!metadata) return;
        void handleNewTicket(channel, metadata).catch(error => {
            logger.warn(`[Ticket AI] Triage failed for ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    logger.info('[Ticket AI] Pre-claim ticket triage enabled. Reports are hard-suppressed.');
}
