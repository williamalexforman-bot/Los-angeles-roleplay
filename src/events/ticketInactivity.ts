import { resolve } from 'path';
import {
    AttachmentBuilder,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type Client,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const SUPPORT_ROLE_ID = '1523122697746382868';
const TICKET_LOG_CHANNEL_ID = '1526255112149008524';
const TICKET_TRANSCRIPT_CHANNEL_ID = '1526255184303493291';
const WARNING_AFTER_MS = 3 * 60 * 60 * 1000;
const CLOSE_AFTER_WARNING_MS = 6 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const WARNING_MARKER = 'Ticket Marked Inactive';
const UNDERBANNER_NAME = 'underbanner.webp';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

type TicketType = 'general' | 'internal' | 'management' | 'highrank';
type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

let scheduler: ReturnType<typeof setInterval> | null = null;
let schedulerClient: Client | null = null;
let tickRunning = false;

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function underbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${UNDERBANNER_NAME}`),
    );
}

function artwork(): AttachmentBuilder[] {
    return [new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME })];
}

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
        if (!parsed.ownerId || !['general', 'internal', 'management', 'highrank'].includes(parsed.type)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function componentText(message: Message): string {
    const output: string[] = [];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.content === 'string') output.push(record.content);
        if (Array.isArray(record.components)) record.components.forEach(visit);
        if (Array.isArray(record.items)) record.items.forEach(visit);
    };
    for (const component of message.components) visit(component.toJSON());
    return output.join('\n');
}

function inactivityPanel(metadata: TicketMetadata): ContainerBuilder {
    const claimed = Boolean(metadata.claimedBy);
    const mentions = claimed
        ? `<@${metadata.ownerId}> <@${metadata.claimedBy}>`
        : `<@&${SUPPORT_ROLE_ID}>`;

    return new ContainerBuilder()
        .setAccentColor(0xf59e0b)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            mentions,
            `## ⏳ ${WARNING_MARKER}`,
            'This ticket has been inactive for **3 hours**.',
            '',
            claimed
                ? 'The ticket opener and the staff member who claimed this ticket have been notified.'
                : 'This ticket has not been claimed, so the Support Team has been notified.',
            '',
            '**Please finish it up and make sure to close it.**',
            `If nobody sends a new message for another **6 hours**, this ticket will be closed automatically.`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(underbanner());
}

function autoCloseLogPanel(channel: TextChannel, metadata: TicketMetadata): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0xef4444)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🔒 Ticket Auto-Closed for Inactivity',
            `> **Ticket:** \`${channel.name}\``,
            `> **Opened By:** <@${metadata.ownerId}>`,
            `> **Claimed By:** ${metadata.claimedBy ? `<@${metadata.claimedBy}>` : 'Unclaimed'}`,
            '> **Reason:** No new human messages were sent for 6 hours after the inactivity warning.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(underbanner());
}

function ownerAutoClosePanel(channelName: string, metadata: TicketMetadata): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🔒 Your Ticket Was Closed',
            `Your ticket **${channelName}** was automatically closed because it stayed inactive for 6 hours after the inactivity warning.`,
            metadata.claimedBy ? `It had been claimed by <@${metadata.claimedBy}>.` : 'It had not been claimed.',
            '',
            'If you still need help, you may open a new ticket.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(underbanner());
}

async function fetchRecentMessages(channel: TextChannel): Promise<Message[]> {
    const collection = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!collection) return [];
    return [...collection.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function transcriptBuffer(messages: readonly Message[]): Buffer {
    const lines = messages.map(message => {
        const text = message.cleanContent.trim() || componentText(message).replace(/\n+/g, ' | ').trim() || '[no text]';
        return `[${message.createdAt.toISOString()}] ${message.author.tag}: ${text}`;
    });
    return Buffer.from(lines.join('\n') || 'No messages were available.', 'utf8');
}

async function autoCloseTicket(client: Client, channel: TextChannel, metadata: TicketMetadata, messages: Message[]): Promise<void> {
    const transcript = transcriptBuffer(messages);

    const transcriptChannel = await client.channels.fetch(TICKET_TRANSCRIPT_CHANNEL_ID).catch(() => null);
    if (transcriptChannel?.isSendable()) {
        await transcriptChannel.send({
            content: `Automatic inactivity transcript for **${channel.name}**`,
            files: [new AttachmentBuilder(transcript, { name: `${channel.name}-inactivity-transcript.txt` })],
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }

    const logChannel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
    if (logChannel?.isSendable()) {
        await logChannel.send({
            components: [autoCloseLogPanel(channel, metadata)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }

    const owner = await client.users.fetch(metadata.ownerId).catch(() => null);
    if (owner) {
        await owner.send({
            components: [ownerAutoClosePanel(channel.name, metadata)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }

    await channel.delete('Automatically closed after 3-hour inactivity warning plus 6 additional inactive hours.')
        .then(() => logger.info(`[TicketInactivity] Auto-closed ${channel.id} (${channel.name}).`))
        .catch(error => logger.error(`[TicketInactivity] Could not auto-close ${channel.id}: ${error instanceof Error ? error.message : String(error)}`));
}

async function evaluateTicket(client: Client, channel: TextChannel): Promise<void> {
    const metadata = decodeMetadata(channel.topic);
    if (!metadata) return;

    const messages = await fetchRecentMessages(channel);
    const lastHuman = [...messages].reverse().find(message => !message.author.bot);
    const lastHumanAt = lastHuman?.createdTimestamp
        ?? Date.parse(metadata.createdAt)
        ?? channel.createdTimestamp;
    const safeLastHumanAt = Number.isFinite(lastHumanAt) ? lastHumanAt : channel.createdTimestamp;

    const warning = [...messages].reverse().find(message =>
        message.author.id === client.user?.id && componentText(message).includes(WARNING_MARKER),
    );

    if (warning && warning.createdTimestamp > safeLastHumanAt) {
        if (Date.now() - warning.createdTimestamp >= CLOSE_AFTER_WARNING_MS) {
            await autoCloseTicket(client, channel, metadata, messages);
        }
        return;
    }

    if (Date.now() - safeLastHumanAt < WARNING_AFTER_MS) return;

    const claimed = Boolean(metadata.claimedBy);
    const allowedMentions = claimed
        ? { parse: [] as [], users: [metadata.ownerId, metadata.claimedBy!] }
        : { parse: [] as [], roles: [SUPPORT_ROLE_ID] };

    await channel.send({
        components: [inactivityPanel(metadata)],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions,
    }).then(() => {
        logger.info(`[TicketInactivity] Marked ${channel.id} inactive after 3 hours.`);
    }).catch(error => {
        logger.warn(`[TicketInactivity] Could not warn in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function tick(): Promise<void> {
    const client = schedulerClient;
    if (!client?.isReady() || tickRunning) return;
    tickRunning = true;
    try {
        for (const guild of client.guilds.cache.values()) {
            await guild.channels.fetch().catch(() => undefined);
            const ticketChannels = guild.channels.cache.filter(channel =>
                channel.type === ChannelType.GuildText && Boolean(decodeMetadata(channel.topic)),
            );
            for (const channel of ticketChannels.values()) {
                if (channel.type !== ChannelType.GuildText) continue;
                await evaluateTicket(client, channel).catch(error => {
                    logger.warn(`[TicketInactivity] Evaluation failed for ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
                });
            }
        }
    } finally {
        tickRunning = false;
    }
}

export function startTicketInactivityScheduler(client: Client): void {
    schedulerClient = client;
    if (scheduler) return;
    // Do not scan every guild immediately at READY. Render's shared egress was
    // being rate-limited by Discord, so give the core gateway/interaction path
    // a quiet startup window. The normal five-minute interval performs the
    // first scan automatically.
    scheduler = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    scheduler.unref?.();
    logger.info('[TicketInactivity] Scheduler active: first REST scan delayed 5m; warn after 3h, auto-close 6h later if still inactive.');
}
