import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    TextChannel,
    type Message,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import { LoaRequest as LoaRequestModel, type LoaRequestRecord } from '../database/models';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const LEGACY_LOA_CHANNEL_ID = process.env.LOA_REQUEST_CHANNEL_ID || '1528206019237515344';
const ACTIVE_LOA_CHANNEL_ID = '1541223750832357456';
const LOA_ROLE_ID = process.env.LOA_ROLE_ID || '1521593407795888329';

type ComponentNode = {
    content?: unknown;
    custom_id?: string;
    components?: readonly ComponentNode[];
};

function nodes(message: Message): ComponentNode[] {
    return message.components.map(component => component.toJSON() as unknown as ComponentNode);
}

function textValues(message: Message): string[] {
    const values: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.content === 'string') values.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const node of nodes(message)) visit(node);
    return values;
}

function field(message: Message, name: string): string {
    const prefix = `**${name}**\n`;
    const found = textValues(message).find(value => value.toLowerCase().startsWith(prefix.toLowerCase()));
    return found?.slice(prefix.length).trim() || '';
}

function hasActiveButton(message: Message, pendingId?: string): boolean {
    const all = JSON.stringify(nodes(message));
    if (pendingId) return all.includes(`loa:active:end-early:${pendingId}`);
    return all.includes('loa:active:end-early:');
}

function isLegacyApproved(message: Message, client: Client): boolean {
    if (message.author.id !== client.user?.id) return false;
    if (message.channelId !== LEGACY_LOA_CHANNEL_ID) return false;
    const all = textValues(message).join('\n');
    return /LOA Approved/iu.test(all)
        && Boolean(field(message, 'Member'))
        && Boolean(field(message, 'End Date'));
}

function timestampValue(value: string): Date | null {
    const unix = value.match(/<t:(\d+)(?::[A-Za-z])?>/u)?.[1];
    if (unix) return new Date(Number(unix) * 1_000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function discordDate(date: Date): string {
    return `<t:${Math.floor(date.getTime() / 1_000)}:F>`;
}

async function storedRecordFor(userId: string, end: Date): Promise<{ pendingId: string; record: LoaRequestRecord } | null> {
    if (!isDatabaseAvailable()) return null;
    const records = await LoaRequestModel.find({ userId, status: 'Approved' })
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean()
        .exec()
        .catch(() => []);
    if (!records.length) return null;

    let best: { pendingId: string; record: LoaRequestRecord; delta: number } | null = null;
    for (const raw of records) {
        const record = raw as unknown as LoaRequestRecord & { pendingId?: string };
        if (!record.pendingId) continue;
        const candidateEnd = new Date(record.endDate);
        if (Number.isNaN(candidateEnd.getTime())) continue;
        const delta = Math.abs(candidateEnd.getTime() - end.getTime());
        if (!best || delta < best.delta) best = { pendingId: record.pendingId, record, delta };
    }
    return best ? { pendingId: best.pendingId, record: best.record } : null;
}

function activeEmbed(
    userId: string,
    name: string,
    start: Date,
    end: Date,
    reason: string,
    approvedBy: string,
): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🟢 Active Leave of Absence')
        .setDescription('This Leave of Absence is currently active. Management or the member may use **End Early** if the LOA is no longer needed.')
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Member', value: `<@${userId}>`, inline: true },
            { name: 'Name', value: name, inline: true },
            { name: 'Start Date', value: discordDate(start), inline: true },
            { name: 'End Date', value: discordDate(end), inline: true },
            { name: 'Reason', value: reason },
            { name: 'Approved By', value: approvedBy, inline: true },
            { name: 'LOA Role', value: `<@&${LOA_ROLE_ID}>`, inline: true },
            { name: 'Status', value: '🟢 Active', inline: true },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

async function migrateMessage(client: Client, message: Message, activeChannel: TextChannel): Promise<boolean> {
    const memberField = field(message, 'Member');
    const userId = memberField.match(/<@!?(\d{17,20})>/u)?.[1];
    const start = timestampValue(field(message, 'Start Date'));
    const end = timestampValue(field(message, 'End Date'));
    if (!userId || !start || !end) return false;

    // Ignore historical approvals that have already passed their end date.
    if (end.getTime() <= Date.now()) return false;

    const stored = await storedRecordFor(userId, end);
    const pendingId = stored?.pendingId || `legacy-${message.id}`;

    const activeMessages = await activeChannel.messages.fetch({ limit: 100 }).catch(() => null);
    if (activeMessages?.some(candidate => hasActiveButton(candidate, pendingId))) {
        await message.delete().catch(() => undefined);
        return true;
    }

    const name = stored?.record.name || field(message, 'Name') || userId;
    const reason = stored?.record.reason || 'Recovered from an existing approved LOA.';
    const approvedBy = stored?.record.reviewerId
        ? `<@${stored.record.reviewerId}>`
        : 'Management';

    const actionRows = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`loa:active:end-early:${pendingId}`)
                .setLabel('End Early')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
        ),
    ];

    const posted = await activeChannel.send(legacyEmbedToV2Message(
        activeEmbed(userId, name, start, end, reason, approvedBy),
        {
            content: `<@${userId}>`,
            actionRows,
            allowedMentions: { parse: [], users: [userId] },
        },
    )).then(() => true).catch(error => {
        logger.warn(`[LOA] Could not migrate legacy active LOA ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    });

    if (posted) await message.delete().catch(() => undefined);
    return posted;
}

async function runMigration(client: Client): Promise<void> {
    const legacy = await client.channels.fetch(LEGACY_LOA_CHANNEL_ID).catch(() => null);
    const active = await client.channels.fetch(ACTIVE_LOA_CHANNEL_ID).catch(() => null);
    if (!(legacy instanceof TextChannel) || !(active instanceof TextChannel)) return;

    const messages = await legacy.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;

    let moved = 0;
    for (const message of messages.values()) {
        if (!isLegacyApproved(message, client)) continue;
        if (await migrateMessage(client, message, active)) moved += 1;
    }
    if (moved) logger.info(`[LOA] Migrated ${moved} existing active LOA(s) to <#${ACTIVE_LOA_CHANNEL_ID}>.`);
}

export function registerLegacyLoaActiveMigration(client: Client): void {
    const timer = setTimeout(() => {
        void runMigration(client).catch(error => {
            logger.warn(`[LOA] Legacy active-LOA migration failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 8_000);
    timer.unref?.();
}
