import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextChannel,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import { GiveawayState, type GiveawayRecord } from '../database/giveawayModel';
import { logger } from '../utils/logger';

const GIVEAWAY_BANNER_NAME = 'giveaway-banner.png';
const GIVEAWAY_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', GIVEAWAY_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const GIVEAWAY_BUTTON_ID = 'giveaway:enter';
const MIN_DURATION_MS = 10_000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const ENDING_LEASE_MS = 2 * 60_000;
const SCHEDULER_INTERVAL_MS = 5_000;

const registeredClients = new WeakSet<Client>();
const entryLocks = new Map<string, Promise<void>>();

type GiveawaySnapshot = Pick<GiveawayRecord,
    'hostId' | 'prize' | 'winnerCount' | 'endsAt' | 'entrantIds' | 'winnerIds' | 'status' | 'endedAt'
>;

type ArtworkUrls = {
    banner: string;
    footer: string;
};

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(url: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
}

function giveawayArtwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(GIVEAWAY_BANNER_PATH, { name: GIVEAWAY_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function discordTimestamp(date: Date, style: 'F' | 'R'): string {
    return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function entryLabel(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? 'Entry' : 'Entries'}`;
}

export function buildGiveawayPanel(
    giveaway: GiveawaySnapshot,
    artwork: ArtworkUrls = {
        banner: `attachment://${GIVEAWAY_BANNER_NAME}`,
        footer: `attachment://${UNDERBANNER_NAME}`,
    },
): ContainerBuilder {
    const entryCount = giveaway.entrantIds.length;
    const ended = giveaway.status === 'ended';
    const details = [
        '## 🎉 Los Angeles Giveaway',
        `> **Prize:** ${giveaway.prize}`,
        `> **Winner${giveaway.winnerCount === 1 ? '' : 's'}:** \`${giveaway.winnerCount}\``,
        `> **Hosted By:** <@${giveaway.hostId}>`,
        ended
            ? `> **Ended:** ${discordTimestamp(giveaway.endedAt || giveaway.endsAt, 'F')}`
            : `> **Ends:** ${discordTimestamp(giveaway.endsAt, 'F')} (${discordTimestamp(giveaway.endsAt, 'R')})`,
    ].join('\n');

    const result = giveaway.winnerIds.length
        ? `### 🏆 Winner${giveaway.winnerIds.length === 1 ? '' : 's'}\n${giveaway.winnerIds.map(id => `<@${id}>`).join(' ')}`
        : '### Giveaway Ended\nNo one entered this giveaway, so no winner was selected.';
    const entryText = ended
        ? `${result}\n\n**Total Entries:** \`${entryCount.toLocaleString()}\``
        : `### 🎟️ Entries\n**${entryCount.toLocaleString()}** ${entryCount === 1 ? 'person has' : 'people have'} entered this giveaway.`;

    const button = new ButtonBuilder()
        .setCustomId(GIVEAWAY_BUTTON_ID)
        .setEmoji(ended ? '🏁' : '🎉')
        .setLabel(ended ? `Giveaway Ended • ${entryLabel(entryCount)}` : `Enter Giveaway • ${entryLabel(entryCount)}`)
        .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(ended);

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(artwork.banner))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(entryText))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(artwork.footer));
}

const DURATION_UNIT_MS: Record<string, number> = {
    s: 1_000,
    sec: 1_000,
    secs: 1_000,
    second: 1_000,
    seconds: 1_000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 60 * 60_000,
    hr: 60 * 60_000,
    hrs: 60 * 60_000,
    hour: 60 * 60_000,
    hours: 60 * 60_000,
    d: 24 * 60 * 60_000,
    day: 24 * 60 * 60_000,
    days: 24 * 60 * 60_000,
    w: 7 * 24 * 60 * 60_000,
    week: 7 * 24 * 60 * 60_000,
    weeks: 7 * 24 * 60 * 60_000,
};

/** Parses durations such as `30m`, `2 hours`, or `1d 12h`. */
export function parseGiveawayDuration(input: string): number | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return null;

    const token = /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)/g;
    let total = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;
    let matched = false;

    while ((match = token.exec(normalized)) !== null) {
        if (normalized.slice(cursor, match.index).trim()) return null;
        const amount = Number(match[1]);
        const multiplier = DURATION_UNIT_MS[match[2]];
        if (!Number.isSafeInteger(amount) || amount < 1 || !multiplier) return null;
        total += amount * multiplier;
        if (!Number.isSafeInteger(total)) return null;
        cursor = token.lastIndex;
        matched = true;
    }

    if (!matched || normalized.slice(cursor).trim()) return null;
    return total;
}

export function pickGiveawayWinners(entrantIds: readonly string[], count: number): string[] {
    const pool = [...new Set(entrantIds)];
    const winners: string[] = [];
    while (pool.length && winners.length < count) {
        const selected = randomInt(pool.length);
        winners.push(pool[selected]);
        pool.splice(selected, 1);
    }
    return winners;
}

function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
    if (!interaction.member) return [];
    if (Array.isArray(interaction.member.roles)) return interaction.member.roles;
    return [...interaction.member.roles.cache.keys()];
}

async function canCreateGiveaway(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;

    const authorizedRoles = [
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((id): id is string => Boolean(id));
    if (authorizedRoles.some(id => memberRoleIds(interaction).includes(id))) return true;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member && authorizedRoles.some(id => member.roles.cache.has(id)));
}

type ComponentNode = {
    components?: ComponentNode[];
    items?: ComponentNode[];
    media?: { url?: string };
    data?: ComponentNode;
    toJSON?: () => ComponentNode;
};

function messageArtworkUrls(message: Message): ArtworkUrls {
    const attachments = [...message.attachments.values()];
    const bannerAttachment = attachments.find(item => item.name === GIVEAWAY_BANNER_NAME);
    const footerAttachment = attachments.find(item => item.name === UNDERBANNER_NAME);
    const mediaUrls: string[] = [];

    const visit = (node: ComponentNode): void => {
        const value = node.data || node;
        if (value.media?.url) mediaUrls.push(value.media.url);
        for (const item of value.items || []) visit(item);
        for (const component of value.components || []) visit(component);
    };
    for (const component of message.components as unknown as ComponentNode[]) {
        const value = typeof component.toJSON === 'function' ? component.toJSON() : component;
        visit(value);
    }

    return {
        banner: bannerAttachment?.url || mediaUrls[0] || `attachment://${GIVEAWAY_BANNER_NAME}`,
        footer: footerAttachment?.url || mediaUrls[1] || `attachment://${UNDERBANNER_NAME}`,
    };
}

async function withEntryLock<T>(messageId: string, operation: () => Promise<T>): Promise<T> {
    const previous = entryLocks.get(messageId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolveLock => { release = resolveLock; });
    const queued = previous.then(() => current);
    entryLocks.set(messageId, queued);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (entryLocks.get(messageId) === queued) entryLocks.delete(messageId);
    }
}

async function refreshGiveawayMessage(message: Message, giveaway: GiveawayRecord): Promise<void> {
    await message.edit({
        components: [buildGiveawayPanel(giveaway, messageArtworkUrls(message))],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

export async function handleGiveawayButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== GIVEAWAY_BUTTON_ID) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isDatabaseAvailable()) {
        await interaction.editReply('Giveaway entries are temporarily unavailable while persistent storage reconnects. Please try again shortly.');
        return true;
    }

    await withEntryLock(interaction.message.id, async () => {
        const now = new Date();
        const updated = await GiveawayState.findOneAndUpdate(
            {
                messageId: interaction.message.id,
                status: 'active',
                endsAt: { $gt: now },
                entrantIds: { $ne: interaction.user.id },
            },
            {
                $addToSet: { entrantIds: interaction.user.id },
                $set: { updatedAt: now },
            },
            { new: true },
        ).lean().exec();

        if (!updated) {
            const existing = await GiveawayState.findOne({ messageId: interaction.message.id }).lean().exec();
            if (!existing) {
                await interaction.editReply('This giveaway is no longer available.');
            } else if (existing.status !== 'active' || existing.endsAt.getTime() <= Date.now()) {
                await interaction.editReply('This giveaway has ended and the winner selection is being completed.');
            } else {
                await interaction.editReply('You are already entered in this giveaway.');
            }
            return;
        }

        await refreshGiveawayMessage(interaction.message, updated).catch(error => {
            logger.warn(`[Giveaway] Could not refresh entry count for ${updated.messageId}: ${error instanceof Error ? error.message : String(error)}`);
        });
        await interaction.editReply(`🎉 You are entered! This giveaway now has **${updated.entrantIds.length.toLocaleString()}** ${updated.entrantIds.length === 1 ? 'entry' : 'entries'}.`);
    });

    return true;
}

async function finishGiveaway(client: Client, candidate: GiveawayRecord): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - ENDING_LEASE_MS);
    const claimed = await GiveawayState.findOneAndUpdate(
        {
            messageId: candidate.messageId,
            $or: [
                { status: 'active', endsAt: { $lte: now } },
                { status: 'ending', processingStartedAt: { $lte: staleBefore } },
            ],
        },
        {
            $set: {
                status: 'ending',
                processingStartedAt: now,
                updatedAt: now,
            },
        },
        { new: true },
    ).lean().exec();
    if (!claimed) return false;

    let winnerIds = claimed.winnerIds || [];
    if (!winnerIds.length && claimed.entrantIds.length) {
        winnerIds = pickGiveawayWinners(claimed.entrantIds, claimed.winnerCount);
        await GiveawayState.updateOne(
            { messageId: claimed.messageId, status: 'ending' },
            { $set: { winnerIds, updatedAt: new Date() } },
        ).exec();
    }

    const channel = await client.channels.fetch(claimed.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.isSendable() || !('messages' in channel)) {
        logger.warn(`[Giveaway] Channel ${claimed.channelId} is unavailable while ending ${claimed.messageId}.`);
        return false;
    }
    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(claimed.messageId).catch(() => null);
    const endedAt = new Date();
    const completed: GiveawayRecord = {
        ...claimed,
        winnerIds,
        status: 'ended',
        endedAt,
        updatedAt: endedAt,
    };

    if (message) {
        await refreshGiveawayMessage(message, completed).catch(error => {
            logger.warn(`[Giveaway] Could not mark panel ${claimed.messageId} ended: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    let resultMessageId = claimed.resultMessageId;
    if (winnerIds.length && !resultMessageId) {
        const winnerMentions = winnerIds.map(id => `<@${id}>`).join(' ');
        const result = await textChannel.send({
            content: `🎉 Congratulations ${winnerMentions}! You won **${claimed.prize}**!\n${message?.url || `https://discord.com/channels/${claimed.guildId}/${claimed.channelId}/${claimed.messageId}`}`,
            allowedMentions: { parse: [], users: winnerIds },
        });
        resultMessageId = result.id;
    }

    await GiveawayState.updateOne(
        { messageId: claimed.messageId, status: 'ending' },
        {
            $set: {
                status: 'ended',
                winnerIds,
                resultMessageId,
                endedAt,
                updatedAt: endedAt,
            },
        },
    ).exec();
    logger.info(`[Giveaway] Ended ${claimed.messageId} with ${winnerIds.length} winner(s) from ${claimed.entrantIds.length} entrant(s).`);
    return true;
}

export async function processDueGiveaways(client: Client): Promise<number> {
    if (!isDatabaseAvailable()) return 0;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - ENDING_LEASE_MS);
    const due = await GiveawayState.find({
        $or: [
            { status: 'active', endsAt: { $lte: now } },
            { status: 'ending', processingStartedAt: { $lte: staleBefore } },
        ],
    }).sort({ endsAt: 1 }).limit(25).lean().exec();

    let completed = 0;
    for (const giveaway of due) {
        try {
            if (await finishGiveaway(client, giveaway)) completed += 1;
        } catch (error) {
            logger.error(`[Giveaway] Completion failed for ${giveaway.messageId}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        }
    }
    return completed;
}

export function registerGiveawayScheduler(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    void processDueGiveaways(client);
    const timer = setInterval(() => void processDueGiveaways(client), SCHEDULER_INTERVAL_MS);
    timer.unref?.();
    logger.info('[Giveaway] Durable completion scheduler enabled.');
}

export const giveawayCommand = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start a timed giveaway in the giveaway channel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option => option
            .setName('prize')
            .setDescription('What people can win')
            .setRequired(true)
            .setMaxLength(1_000))
        .addIntegerOption(option => option
            .setName('winners')
            .setDescription('How many people can win')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(20))
        .addStringOption(option => option
            .setName('duration')
            .setDescription('How long it runs, such as 30m, 2h, or 3d')
            .setRequired(true)
            .setMaxLength(50)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.guild || !interaction.guildId) {
            await interaction.editReply('This command can only be used in a server.');
            return;
        }
        if (!(await canCreateGiveaway(interaction))) {
            await interaction.editReply('You need **Manage Server** or an authorized bot-management role to start a giveaway.');
            return;
        }
        if (!isDatabaseAvailable()) {
            await interaction.editReply('I cannot start a reliable giveaway while persistent storage is offline. Please try again after the database reconnects.');
            return;
        }

        const prize = interaction.options.getString('prize', true).trim();
        const winnerCount = interaction.options.getInteger('winners', true);
        const durationInput = interaction.options.getString('duration', true);
        const durationMs = parseGiveawayDuration(durationInput);
        if (!prize) {
            await interaction.editReply('Please provide a giveaway prize.');
            return;
        }
        if (durationMs === null || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
            await interaction.editReply('Use a duration from **10 seconds to 30 days**, such as `30m`, `2h`, `3d`, or `1d 12h`.');
            return;
        }

        const channel = await interaction.client.channels.fetch(CHANNEL_IDS.giveaways).catch(() => null);
        if (!channel || !channel.isTextBased() || !channel.isSendable() || !('messages' in channel)) {
            await interaction.editReply(`I could not access the giveaway channel <#${CHANNEL_IDS.giveaways}>.`);
            return;
        }

        const now = new Date();
        const endsAt = new Date(now.getTime() + durationMs);
        const initial: GiveawaySnapshot = {
            hostId: interaction.user.id,
            prize,
            winnerCount,
            endsAt,
            entrantIds: [],
            winnerIds: [],
            status: 'active',
        };
        const message = await channel.send({
            components: [buildGiveawayPanel(initial)],
            files: giveawayArtwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });

        try {
            await GiveawayState.create({
                guildId: interaction.guildId,
                channelId: channel.id,
                messageId: message.id,
                hostId: interaction.user.id,
                prize,
                winnerCount,
                endsAt,
                entrantIds: [],
                winnerIds: [],
                status: 'active',
                createdAt: now,
                updatedAt: now,
            });
        } catch (error) {
            await message.delete().catch(() => undefined);
            throw error;
        }

        await interaction.editReply(`✅ Giveaway started in <#${CHANNEL_IDS.giveaways}> and will end ${discordTimestamp(endsAt, 'R')}.\n${message.url}`);
        logger.info(`[Giveaway] ${interaction.user.id} started ${message.id}; winners=${winnerCount} endsAt=${endsAt.toISOString()}.`);
    },
};
