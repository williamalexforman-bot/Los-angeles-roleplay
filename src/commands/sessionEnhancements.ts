import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    MessageFlags,
    type TextChannel,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { SessionVoteState, type SessionVoteRecord } from '../database/sessionVoteModel';
import {
    createSessionAttachments,
    createSessionPanel,
    SESSION_ACCENT_COLOR,
} from '../utils/embeds';
import { logger } from '../utils/logger';
import { CHANNEL_IDS, SESSION_START_AUTHORIZED_ROLE_ID } from '../config/constants';
import { erlcSsdReply, shutdownErlcForSsd } from '../services/erlcSessionShutdown';

const ERLC_JOIN_URL = 'https://erlc.gg/join?code=LARNRPP&placeId=2534724415';
const ERLC_GAME_CODE = 'LARNRPP';
const MAX_VOTES = 50;
const SESSION_PING_ROLE_ID = '1521593407749754990';
const SESSION_PING_MENTION = `<@&${SESSION_PING_ROLE_ID}>`;
const SESSION_ANNOUNCEMENT_CHANNEL_ID = CHANNEL_IDS.sessionAnnouncements;

type VoteState = {
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    requiredVotes: number;
    voters: Array<{ userId: string; username: string; votedAt: Date }>;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export interface SessionVoteSnapshot {
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    requiredVotes: number;
    voters: Array<{ userId: string; username: string; votedAt: Date }>;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const memoryVotes = new Map<string, VoteState>();
const voteLocks = new Map<string, Promise<void>>();

function normalizeVote(record: SessionVoteRecord | VoteState): VoteState {
    return {
        guildId: String(record.guildId),
        channelId: String(record.channelId),
        messageId: String(record.messageId),
        startedById: String(record.startedById),
        requiredVotes: Number(record.requiredVotes),
        voters: Array.isArray(record.voters)
            ? record.voters.map(voter => ({
                userId: String(voter.userId),
                username: String(voter.username || 'Unknown'),
                votedAt: voter.votedAt ? new Date(voter.votedAt) : new Date(),
            }))
            : [],
        active: Boolean(record.active),
        createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
        updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    };
}

async function withVoteLock<T>(messageId: string, operation: () => Promise<T>): Promise<T> {
    const previous = voteLocks.get(messageId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    voteLocks.set(messageId, queued);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (voteLocks.get(messageId) === queued) voteLocks.delete(messageId);
    }
}

async function getSessionChannel(interaction: ChatInputCommandInteraction): Promise<TextChannel | null> {
    const channel = await interaction.client.channels.fetch(SESSION_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.isSendable() || !('messages' in channel)) return null;
    return channel as TextChannel;
}

function sessionMemberRoleIds(member: ChatInputCommandInteraction['member']): string[] {
    if (!member) return [];
    if (Array.isArray(member.roles)) return member.roles;
    const cache = (member.roles as { cache?: { keys(): IterableIterator<string> } }).cache;
    return cache?.keys ? [...cache.keys()] : [];
}

async function canStartSession(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (sessionMemberRoleIds(interaction.member).includes(SESSION_START_AUTHORIZED_ROLE_ID)) return true;
    if (!interaction.guild) return false;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member && sessionMemberRoleIds(member).includes(SESSION_START_AUTHORIZED_ROLE_ID));
}

async function saveNewVote(vote: VoteState): Promise<void> {
    memoryVotes.set(vote.messageId, vote);
    if (!isDatabaseAvailable()) return;
    try {
        await SessionVoteState.updateMany(
            { guildId: vote.guildId, channelId: vote.channelId, active: true },
            { $set: { active: false, updatedAt: new Date() } },
        ).exec();
        await SessionVoteState.findOneAndUpdate(
            { messageId: vote.messageId },
            { $set: vote },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec();
    } catch (error) {
        logger.warn(`[Session Vote] Could not persist new vote ${vote.messageId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function loadVote(messageId: string): Promise<VoteState | null> {
    const cached = memoryVotes.get(messageId);
    if (isDatabaseAvailable()) {
        try {
            const stored = await SessionVoteState.findOne({ messageId }).lean().exec();
            if (stored) {
                const vote = normalizeVote(stored as unknown as SessionVoteRecord);
                memoryVotes.set(messageId, vote);
                return vote;
            }
        } catch (error) {
            logger.warn(`[Session Vote] Could not load vote ${messageId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    return cached || null;
}

async function addVoter(
    messageId: string,
    userId: string,
    username: string,
): Promise<{ status: 'added'; vote: VoteState } | { status: 'duplicate' | 'closed' | 'missing' }> {
    const vote = await loadVote(messageId);
    if (!vote) return { status: 'missing' };
    if (!vote.active) return { status: 'closed' };
    if (vote.voters.some(voter => voter.userId === userId)) return { status: 'duplicate' };

    vote.voters.push({ userId, username, votedAt: new Date() });
    if (vote.voters.length >= vote.requiredVotes) vote.active = false;
    vote.updatedAt = new Date();
    memoryVotes.set(messageId, vote);

    if (isDatabaseAvailable()) {
        try {
            await SessionVoteState.updateOne(
                { messageId },
                {
                    $set: {
                        voters: vote.voters,
                        active: vote.active,
                        updatedAt: vote.updatedAt,
                    },
                },
            ).exec();
        } catch (error) {
            logger.warn(`[Session Vote] Could not persist voter ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return { status: 'added', vote };
}

async function latestVote(guildId: string, channelId: string): Promise<VoteState | null> {
    const cached = [...memoryVotes.values()]
        .filter(vote => vote.guildId === guildId && vote.channelId === channelId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] || null;

    if (isDatabaseAvailable()) {
        try {
            const stored = await SessionVoteState.findOne({ guildId, channelId }).sort({ createdAt: -1 }).lean().exec();
            if (stored) {
                const vote = normalizeVote(stored as unknown as SessionVoteRecord);
                const cachedIsNewer = cached && (
                    cached.createdAt.getTime() > vote.createdAt.getTime()
                    || (cached.messageId === vote.messageId
                        && cached.updatedAt.getTime() > vote.updatedAt.getTime())
                );
                if (cachedIsNewer) return cached;
                memoryVotes.set(vote.messageId, vote);
                return vote;
            }
        } catch (error) {
            logger.warn(`[Session Vote] Could not load latest vote: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return cached;
}

export async function getLatestSessionVote(guildId: string): Promise<SessionVoteSnapshot | null> {
    const vote = await latestVote(guildId, SESSION_ANNOUNCEMENT_CHANNEL_ID);
    if (!vote) return null;
    return {
        ...vote,
        voters: vote.voters.map(voter => ({ ...voter })),
    };
}

async function clearVotes(guildId: string, channelId: string): Promise<void> {
    for (const [messageId, vote] of memoryVotes) {
        if (vote.guildId === guildId && vote.channelId === channelId) memoryVotes.delete(messageId);
    }
    if (!isDatabaseAvailable()) return;
    await SessionVoteState.deleteMany({ guildId, channelId }).exec().catch(error => {
        logger.warn(`[Session Vote] Could not clear persisted votes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

function joinSessionButton(): ButtonBuilder {
    return new ButtonBuilder()
        .setLabel('Join Session')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Link)
        .setURL(ERLC_JOIN_URL);
}

function voteButton(currentVotes: number, requiredVotes: number, disabled = false): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`session:vote:cast:${requiredVotes}`)
        .setLabel(`${currentVotes}/${requiredVotes}`)
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled);
}

function viewVotersButton(): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId('session:vote:view')
        .setLabel('View Voters')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary);
}

function sessionPingRoleButton(): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId('session:end:ping-role')
        .setLabel('Get Session Ping Role')
        .setEmoji('🔔')
        .setStyle(ButtonStyle.Primary);
}

function buildVotePanel(startedById: string, requiredVotes: number, currentVotes: number, complete = false) {
    const description = [
        SESSION_PING_MENTION,
        '',
        `**A session vote has been started by <@${startedById}>. Please vote to join.**`,
        '',
        '**NOTE IF YOU VOTE YOU MUST JOIN!**',
        complete ? '\n✅ **Vote goal reached — thank you!**' : '',
    ].join('\n');

    return createSessionPanel(
        'SESSION VOTE',
        description,
        'vote',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(
            voteButton(currentVotes, requiredVotes, complete),
            viewVotersButton(),
        )],
        SESSION_ACCENT_COLOR,
    );
}

function buildStartPanel(interaction: ChatInputCommandInteraction, voterIds: readonly string[]) {
    const voterLine = voterIds.length
        ? `**Session voters — you voted, so please join:**\n${voterIds.map(id => `<@${id}>`).join(' ')}`
        : '';
    const description = [
        SESSION_PING_MENTION,
        '',
        `A session has been started by <@${interaction.user.id}>.`,
        voterLine ? `\n${voterLine}` : '',
        '',
        `To join please click the button below or go to ERLC and enter code **${ERLC_GAME_CODE}**.`,
    ].filter(Boolean).join('\n');

    return createSessionPanel(
        'SESSION START',
        description,
        'start',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(joinSessionButton())],
        SESSION_ACCENT_COLOR,
    );
}

function buildEndPanel(interaction: ChatInputCommandInteraction) {
    return createSessionPanel(
        'SESSION END',
        `The session has been shut down by <@${interaction.user.id}>. Please don't join or you may face punishment.`,
        'end',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(sessionPingRoleButton())],
        SESSION_ACCENT_COLOR,
    );
}

type ComponentLike = {
    components?: readonly ComponentLike[];
    data?: ComponentLike;
    customId?: string;
    custom_id?: string;
    items?: readonly ComponentLike[];
    media?: { url?: string };
    toJSON?: () => ComponentLike;
};

function componentJson(component: ComponentLike): ComponentLike {
    const json = typeof component.toJSON === 'function' ? component.toJSON() : component.data || component;
    return JSON.parse(JSON.stringify(json)) as ComponentLike;
}

function mediaUrls(nodes: readonly ComponentLike[]): string[] {
    const urls: string[] = [];
    const visit = (node: ComponentLike): void => {
        const data = node.data || node;
        if (data.media?.url) urls.push(data.media.url);
        for (const item of data.items || []) visit(item);
        for (const child of data.components || []) visit(child);
    };
    for (const node of nodes) visit(node);
    return urls;
}

function updatedVotePanel(interaction: ButtonInteraction, vote: VoteState) {
    const existingUrls = mediaUrls(
        (interaction.message.components as unknown as ComponentLike[]).map(componentJson),
    );
    const panel = buildVotePanel(
        vote.startedById,
        vote.requiredVotes,
        vote.voters.length,
        !vote.active,
    ).toJSON() as ComponentLike;
    let mediaIndex = 0;
    const visit = (node: ComponentLike): void => {
        if (node.media?.url) {
            const current = existingUrls[mediaIndex++];
            if (current) node.media.url = current;
        }
        for (const item of node.items || []) visit(item);
        for (const child of node.components || []) visit(child);
    };
    visit(panel);
    return panel;
}

async function deleteMessagesExcept(
    channel: TextChannel,
    keepMessageId?: string,
): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    let before: string | undefined;
    const visited = new Set<string>();

    for (;;) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!messages || messages.size === 0) break;
        const page = [...messages.values()];
        const unseen = page.filter(message => !visited.has(message.id));
        if (unseen.length === 0) break;
        unseen.forEach(message => visited.add(message.id));
        const oldest = page.at(-1);

        const candidates = unseen.filter(message => message.id !== keepMessageId);
        for (let index = 0; index < candidates.length; index += 10) {
            const chunk = candidates.slice(index, index + 10);
            const results = await Promise.allSettled(chunk.map(message => message.delete()));
            deleted += results.filter(result => result.status === 'fulfilled').length;
            failed += results.filter(result => result.status === 'rejected').length;
        }

        if (page.length < 100) break;
        if (!oldest || oldest.id === before) break;
        before = oldest.id;
    }

    return { deleted, failed };
}

async function handleSessionVoteCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const requiredVotes = interaction.options.getInteger('votes', true);
    if (requiredVotes < 1 || requiredVotes > MAX_VOTES) {
        await interaction.editReply(`Votes must be between 1 and ${MAX_VOTES}.`);
        return;
    }

    const channel = await getSessionChannel(interaction);
    if (!channel) {
        await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
        return;
    }

    const message = await channel.send({
        components: [buildVotePanel(interaction.user.id, requiredVotes, 0)],
        files: createSessionAttachments('vote'),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID], users: [interaction.user.id] },
    });

    const now = new Date();
    await saveNewVote({
        guildId: interaction.guildId || '',
        channelId: channel.id,
        messageId: message.id,
        startedById: interaction.user.id,
        requiredVotes,
        voters: [],
        active: true,
        createdAt: now,
        updatedAt: now,
    });

    await interaction.editReply(`✅ Session vote posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>. Required votes: **${requiredVotes}**.`);
}

async function handleSessionStartCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await canStartSession(interaction))) {
        await interaction.editReply(`You need <@&${SESSION_START_AUTHORIZED_ROLE_ID}> to start a session.`);
        return;
    }
    const channel = await getSessionChannel(interaction);
    if (!channel) {
        await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
        return;
    }

    const vote = interaction.guildId ? await latestVote(interaction.guildId, channel.id) : null;
    const voterIds = Array.from(new Set((vote?.voters || []).map(voter => voter.userId).filter(id => /^\d+$/.test(id))));

    await channel.send({
        components: [buildStartPanel(interaction, voterIds)],
        files: createSessionAttachments('start'),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: [],
            roles: [SESSION_PING_ROLE_ID],
            users: Array.from(new Set([interaction.user.id, ...voterIds])),
        },
    });

    await interaction.editReply(
        `✅ Session start announcement posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>.`
        + (voterIds.length ? ` Pinged **${voterIds.length}** session voter${voterIds.length === 1 ? '' : 's'}.` : ' No session voters were available to ping.'),
    );
}

async function handleSessionEndCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await canStartSession(interaction))) {
        await interaction.editReply(`You need <@&${SESSION_START_AUTHORIZED_ROLE_ID}> to end a session and shut down ER:LC.`);
        return;
    }
    const erlcResult = await shutdownErlcForSsd();
    if (erlcResult.status === 'failed') {
        logger.error(`[ERLC SSD] Could not kick all players: ${erlcResult.message}`);
    } else {
        logger.info(`[ERLC SSD] ${erlcResult.status === 'kicked' ? 'Kick-all command accepted.' : 'Server was already empty.'}`);
    }

    const channel = await getSessionChannel(interaction);
    if (!channel) {
        await interaction.editReply(
            `The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`
            + erlcSsdReply(erlcResult),
        );
        return;
    }

    // First wipe everything already in the channel. Then post the end panel and
    // make one second pass to remove anything sent while the first cleanup ran.
    const firstCleanup = await deleteMessagesExcept(channel);
    if (interaction.guildId) await clearVotes(interaction.guildId, channel.id);

    const endMessage = await channel.send({
        components: [buildEndPanel(interaction)],
        files: createSessionAttachments('end'),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });

    const secondCleanup = await deleteMessagesExcept(channel, endMessage.id);
    const deleted = firstCleanup.deleted + secondCleanup.deleted;
    const failed = firstCleanup.failed + secondCleanup.failed;

    await interaction.editReply(
        `✅ Session ended in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>. Deleted **${deleted}** message${deleted === 1 ? '' : 's'} so the Session End panel is left by itself.`
        + erlcSsdReply(erlcResult)
        + (failed ? ` ⚠️ **${failed}** message${failed === 1 ? '' : 's'} could not be deleted; make sure the bot has Manage Messages.` : ''),
    );
}

export async function handleEnhancedSessionCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        if (interaction.commandName === 'session-vote') {
            await handleSessionVoteCommand(interaction);
            return true;
        }
        if (interaction.commandName === 'session-start') {
            await handleSessionStartCommand(interaction);
            return true;
        }
        if (interaction.commandName === 'session-end') {
            await handleSessionEndCommand(interaction);
            return true;
        }
        return false;
    } catch (error) {
        logger.error(`[Session Enhanced] Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply('Unable to complete that session command right now. Please try again.').catch(() => undefined);
        } else {
            await interaction.reply({ content: 'Unable to complete that session command right now. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
}

export async function handleEnhancedSessionButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'session:vote:view') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const vote = await loadVote(interaction.message.id);
        if (!vote) {
            await interaction.editReply('I could not load the voter list for this session vote.');
            return true;
        }
        const voters = vote.voters.filter(voter => /^\d+$/.test(voter.userId));
        const list = voters.length
            ? voters.map((voter, index) => `**${index + 1}.** <@${voter.userId}>`).join('\n')
            : 'No one has voted yet.';
        await interaction.editReply({
            content: `## 👥 Session Voters\n**${voters.length}/${vote.requiredVotes} votes**\n\n${list}`,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (!interaction.customId.startsWith('session:vote:cast:')) return false;

    // Votes posted before durable tracking was enabled have no voter record.
    // Let the legacy handler recover those panels from their visible counter.
    if (!(await loadVote(interaction.message.id))) return false;

    await interaction.deferUpdate();
    const feedback = async (content: string): Promise<void> => {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    };

    await withVoteLock(interaction.message.id, async () => {
        const result = await addVoter(interaction.message.id, interaction.user.id, interaction.user.username);
        if (result.status !== 'added') {
            const message = result.status === 'duplicate'
                ? 'You have already voted for this session.'
                : result.status === 'closed'
                    ? 'This session vote is no longer active.'
                    : 'I could not load this session vote. Please ask staff to start a new vote.';
            await feedback(message);
            return;
        }

        const vote = result.vote;
        await interaction.editReply({
            components: [updatedVotePanel(interaction, vote) as never],
        });
        await feedback(
            vote.active
                ? `✅ Your vote has been recorded! **${vote.voters.length}/${vote.requiredVotes}** votes received.`
                : `✅ Your vote has been recorded! **${vote.voters.length}/${vote.requiredVotes}** votes received — the goal has been reached.`,
        );
    });
    return true;
}
