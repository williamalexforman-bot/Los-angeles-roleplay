import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import {
    AuditEvent,
    LoaRequest as LoaRequestModel,
    type LoaRequestRecord,
} from '../database/models';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';
import { getLatestSessionVote } from './sessionEnhancements';

const LOA_ACTIVE_CHANNEL_ID = process.env.LOA_ACTIVE_CHANNEL_ID || '1541223750832357456';
const MAX_VISIBLE_LOAS = 25;

interface ActiveLoaSummary {
    pendingId: string;
    userId: string;
    name: string;
    startAt: Date;
    endAt: Date;
}

type ComponentNode = {
    content?: unknown;
    custom_id?: string;
    components?: readonly ComponentNode[];
};

function discordDate(value: string, endOfDay = false): Date | null {
    const unix = value.match(/<t:(\d+)(?::[A-Za-z])?>/u)?.[1];
    if (unix) return new Date(Number(unix) * 1_000);

    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        return new Date(Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            endOfDay ? 23 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 999 : 0,
        ));
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function componentData(message: { components?: readonly { toJSON?: () => unknown }[] }): {
    fields: Map<string, string>;
    customIds: string[];
} {
    const fields = new Map<string, string>();
    const customIds: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.custom_id === 'string') customIds.push(node.custom_id);
        if (typeof node.content === 'string') {
            const match = node.content.match(/^\*\*([^*]+)\*\*\n([\s\S]+)$/u);
            if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
        }
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components || []) {
        const json = (typeof component.toJSON === 'function' ? component.toJSON() : component) as ComponentNode;
        visit(json);
    }
    return { fields, customIds };
}

function loaFromMessage(message: {
    components?: readonly { toJSON?: () => unknown }[];
}): ActiveLoaSummary | null {
    const { fields, customIds } = componentData(message);
    const activeId = customIds.find(id => id.startsWith('loa:active:end-early:'));
    if (!activeId) return null;

    const pendingId = activeId.slice('loa:active:end-early:'.length);
    const member = fields.get('member') || '';
    const userId = member.match(/<@!?(\d{17,20})>/u)?.[1]
        || pendingId.match(/^(\d{17,20})-/u)?.[1];
    const startAt = discordDate(fields.get('start date') || '');
    const endAt = discordDate(fields.get('end date') || '', true);
    if (!userId || !startAt || !endAt) return null;

    return {
        pendingId,
        userId,
        name: fields.get('name') || userId,
        startAt,
        endAt,
    };
}

async function activeLoasFromDiscord(interaction: ChatInputCommandInteraction): Promise<{
    available: boolean;
    records: ActiveLoaSummary[];
}> {
    const channel = await interaction.client.channels.fetch(LOA_ACTIVE_CHANNEL_ID).catch(() => null);
    if (!channel || !('messages' in channel)) return { available: false, records: [] };

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return { available: false, records: [] };
    const records = [...messages.values()]
        .map(message => loaFromMessage(message))
        .filter((record): record is ActiveLoaSummary => Boolean(record));
    return { available: true, records };
}

function loaFromRecord(record: LoaRequestRecord): ActiveLoaSummary | null {
    const startAt = discordDate(record.startDate);
    const endAt = discordDate(record.endDate, true);
    if (!startAt || !endAt) return null;
    return {
        pendingId: record.pendingId,
        userId: record.userId,
        name: record.name || record.memberUsername || record.userId,
        startAt,
        endAt,
    };
}

async function activeLoasFromDatabase(guildId: string): Promise<ActiveLoaSummary[]> {
    if (!isDatabaseAvailable()) return [];
    try {
        const [stored, ended] = await Promise.all([
            LoaRequestModel.find({ guildId, status: 'Approved' }).lean().exec(),
            AuditEvent.find({ guildId, kind: 'loa-ended' }).lean().exec(),
        ]);
        const endedIds = new Set(ended.map(record => String(record.targetId || '')));
        return stored
            .map(record => loaFromRecord(record as unknown as LoaRequestRecord))
            .filter((record): record is ActiveLoaSummary => Boolean(record && !endedIds.has(record.pendingId)));
    } catch (error) {
        logger.warn(`[View] Could not load active LOAs: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

function activeLoaEmbed(records: readonly ActiveLoaSummary[], unavailable: boolean): EmbedBuilder {
    const now = Date.now();
    const current = records
        .filter(record => record.endAt.getTime() >= now)
        .sort((left, right) => left.endAt.getTime() - right.endAt.getTime());
    const visible = current.slice(0, MAX_VISIBLE_LOAS);
    const lines = visible.map((record, index) => [
        `**${index + 1}. ${record.name}** — <@${record.userId}>`,
        `<t:${Math.floor(record.startAt.getTime() / 1_000)}:d> → <t:${Math.floor(record.endAt.getTime() / 1_000)}:d>`,
    ].join('\n'));

    let description: string;
    if (lines.length) {
        description = [
            `**Active LOAs:** \`${current.length}\``,
            '',
            ...lines,
            ...(current.length > visible.length
                ? ['', `*And ${current.length - visible.length} more active LOA${current.length - visible.length === 1 ? '' : 's'}.*`]
                : []),
        ].join('\n');
    } else if (unavailable) {
        description = 'The active LOA records are temporarily unavailable. Please try again shortly.';
    } else {
        description = 'There are no active Leaves of Absence right now.';
    }

    return new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🟢 Active Leaves of Absence')
        .setDescription(description)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

function sessionVoteEmbed(vote: Awaited<ReturnType<typeof getLatestSessionVote>>): EmbedBuilder {
    const voters = (vote?.voters || []).filter(voter => /^\d{17,20}$/u.test(voter.userId));
    const list = voters.length
        ? voters.map((voter, index) => `**${index + 1}.** <@${voter.userId}>`).join('\n')
        : 'No one has voted yet.';
    const description = vote
        ? [
            `**Votes:** \`${voters.length}/${vote.requiredVotes}\``,
            `**Started By:** <@${vote.startedById}>`,
            `**Status:** ${vote.active ? 'Voting open' : 'Vote goal reached'}`,
            '',
            list,
        ].join('\n')
        : 'There is no recorded session vote to display.';

    return new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle('👥 SSU Session Voters')
        .setDescription(description)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

async function executeLoaView(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const discord = await activeLoasFromDiscord(interaction);
    const stored = interaction.guildId ? await activeLoasFromDatabase(interaction.guildId) : [];
    const combined = new Map<string, ActiveLoaSummary>();
    for (const record of stored) combined.set(record.pendingId, record);
    for (const record of discord.records) combined.set(record.pendingId, record);

    await interaction.editReply(legacyEmbedToV2Message(
        activeLoaEmbed([...combined.values()], !discord.available && !isDatabaseAvailable()),
    ));
}

async function executeSessionVoteView(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const vote = interaction.guildId ? await getLatestSessionVote(interaction.guildId) : null;
    await interaction.editReply(legacyEmbedToV2Message(sessionVoteEmbed(vote)));
}

export const viewCommand = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('View current server records')
        .setDMPermission(false)
        .addSubcommand(subcommand => subcommand
            .setName('loa')
            .setDescription('Post the current active LOAs as a V2 panel'))
        .addSubcommandGroup(group => group
            .setName('session')
            .setDescription('View session records')
            .addSubcommand(subcommand => subcommand
                .setName('vote')
                .setDescription('Privately view who voted for the latest SSU'))),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand(true);
        if (!group && subcommand === 'loa') {
            await executeLoaView(interaction);
            return;
        }
        if (group === 'session' && subcommand === 'vote') {
            await executeSessionVoteView(interaction);
            return;
        }
        await interaction.reply({ content: 'That view is not available.', flags: MessageFlags.Ephemeral });
    },
};
