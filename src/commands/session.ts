import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    type Message,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import {
    createSessionPanel,
    createSessionAttachments,
    SESSION_ACCENT_COLOR,
} from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { logger } from '../utils/logger';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ERLC_JOIN_URL = 'https://erlc.gg/join?code=LARNRPP&placeId=2534724415';
const ERLC_GAME_CODE = 'LARNRPP';
const MAX_VOTES = 50;
const SESSION_PING_ROLE_ID = '1521593407749754990';
const SESSION_PING_MENTION = `<@&${SESSION_PING_ROLE_ID}>`;
const SESSION_ANNOUNCEMENT_CHANNEL_ID = '1526036392147423404';

async function getSessionAnnouncementChannel(interaction: ChatInputCommandInteraction) {
    const channel = await interaction.client.channels.fetch(SESSION_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

type SessionComponentNode = {
    components?: readonly SessionComponentNode[];
    customId?: string;
    custom_id?: string;
    data?: SessionComponentNode;
};

function hasSessionComponent(nodes: readonly SessionComponentNode[]): boolean {
    return nodes.some(node => {
        const data = node.data || node;
        const customId = data.customId || data.custom_id;
        return Boolean(customId?.startsWith('session:'))
            || hasSessionComponent(data.components || [])
            || (data !== node && hasSessionComponent(node.components || []));
    });
}

function isSessionAnnouncementMessage(message: Message): boolean {
    if (hasSessionComponent(message.components as unknown as SessionComponentNode[])) return true;
    if (message.embeds.some(embed => /^SESSION (START|VOTE|END|BOOST|FULL)$/i.test(embed.title || ''))) return true;
    return message.attachments.some(attachment => /^session-(start|vote|end|boost|full)(?:-banner|-combo)?\.png$/i.test(attachment.name || ''));
}

async function deletePreviousSessionAnnouncements(
    channel: Awaited<ReturnType<typeof getSessionAnnouncementChannel>>,
    botUserId: string,
): Promise<{ deleted: number; failed: number }> {
    if (!channel) return { deleted: 0, failed: 0 };
    let deleted = 0;
    let failed = 0;
    let before: string | undefined;
    const visited = new Set<string>();

    // Discord returns at most 100 messages per request. Walk every page so an
    // old start/vote/boost/full announcement cannot survive session cleanup.
    for (;;) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!messages || messages.size === 0) break;
        const page = [...messages.values()];
        const unseen = page.filter(message => !visited.has(message.id));
        if (unseen.length === 0) break;
        unseen.forEach(message => visited.add(message.id));

        const previousAnnouncements = unseen.filter(message =>
            message.author.id === botUserId && isSessionAnnouncementMessage(message),
        );
        const results = await Promise.allSettled(previousAnnouncements.map(message => message.delete()));
        deleted += results.filter(result => result.status === 'fulfilled').length;
        failed += results.filter(result => result.status === 'rejected').length;

        if (page.length < 100) break;
        const oldest = page.at(-1);
        if (!oldest || oldest.id === before) break;
        before = oldest.id;
    }

    return { deleted, failed };
}

/* -------------------------------------------------------------------------- */
/*  In-memory session vote state                                               */
/* -------------------------------------------------------------------------- */

interface SessionVote {
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    requiredVotes: number;
    voters: string[];
    active: boolean;
    usesPanel: boolean;
}

const activeVotes: Map<string, SessionVote> = new Map();
const voteLocks: Map<string, Promise<void>> = new Map();

function voteKey(guildId: string, messageId: string): string {
    return `${guildId}:${messageId}`;
}

/** Serializes updates to one vote message so simultaneous clicks cannot overwrite a count. */
async function withVoteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = voteLocks.get(key) || Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>(resolve => { releaseCurrent = resolve; });
    const queued = previous.then(() => current);
    voteLocks.set(key, queued);

    await previous;
    try {
        return await operation();
    } finally {
        releaseCurrent();
        if (voteLocks.get(key) === queued) voteLocks.delete(key);
    }
}

/* -------------------------------------------------------------------------- */
/*  Embed builders                                                             */
/* -------------------------------------------------------------------------- */

function buildSessionStartPanel(interaction: ChatInputCommandInteraction) {
    const description = [
        SESSION_PING_MENTION,
        '',
        `A session has been started by <@${interaction.user.id}>.`,
        '',
        `To join please click the button below or go to ERLC and enter code **${ERLC_GAME_CODE}**.`,
    ].join('\n');

    return createSessionPanel(
        'SESSION START',
        description,
        'start',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(joinSessionButton())],
        SESSION_ACCENT_COLOR,
    );
}

function buildSessionVotePanel(
    startedById: string,
    requiredVotes: number,
    currentVotes: number,
    voteComplete = false,
) {
    const description = [
        SESSION_PING_MENTION,
        '',
        `**A session vote has been started by <@${startedById}>. Please vote to join.**`,
        '',
        '**NOTE IF YOU VOTE YOU MUST JOIN!**',
        voteComplete ? '\n✅ **Vote goal reached — thank you!**' : '',
    ].join('\n');

    return createSessionPanel(
        'SESSION VOTE',
        description,
        'vote',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(
            voteButton(currentVotes, requiredVotes, voteComplete),
        )],
        SESSION_ACCENT_COLOR,
    );
}

function buildSessionEndPanel(interaction: ChatInputCommandInteraction) {
    const description = `${SESSION_PING_MENTION}\n\nThe session has been shut down by <@${interaction.user.id}>. Please don't join or you may face punishment.`;
    return createSessionPanel(
        'SESSION END',
        description,
        'end',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(sessionPingRoleButton())],
        SESSION_ACCENT_COLOR,
    );
}

function buildSessionBoostPanel() {
    const description = `${SESSION_PING_MENTION}\n\nThe session has been boosted. Make sure to join up to help us grow.`;
    return createSessionPanel(
        'SESSION BOOST',
        description,
        'boost',
        [new ActionRowBuilder<ButtonBuilder>().addComponents(joinSessionButton())],
        SESSION_ACCENT_COLOR,
    );
}

function buildSessionFullPanel() {
    const description = `${SESSION_PING_MENTION}\n\nThe session is full. If you try to join you will be put into a waiting room.`;
    return createSessionPanel(
        'SESSION FULL',
        description,
        'full',
        [],
        SESSION_ACCENT_COLOR,
    );
}

/* -------------------------------------------------------------------------- */
/*  Component builders                                                         */
/* -------------------------------------------------------------------------- */

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

function sessionPingRoleButton(): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId('session:end:ping-role')
        .setLabel('Get Session Ping Role')
        .setEmoji('🔔')
        .setStyle(ButtonStyle.Primary);
}

type ComponentLike = {
    components?: readonly ComponentLike[];
    data?: ComponentLike;
    customId?: string;
    custom_id?: string;
    label?: string;
    content?: string;
    items?: readonly ComponentLike[];
    media?: { url?: string };
    type?: number;
    toJSON?: () => ComponentLike;
};

function componentJson(component: ComponentLike): ComponentLike {
    const json = typeof component.toJSON === 'function'
        ? component.toJSON()
        : component.data || component;
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

/** Preserve Discord's CDN gallery URLs when changing a live V2 vote panel. */
function updatedVotePanel(
    interaction: ButtonInteraction,
    vote: SessionVote,
    currentVotes: number,
    completed: boolean,
) {
    const existingUrls = mediaUrls(
        (interaction.message.components as unknown as ComponentLike[]).map(componentJson),
    );
    const panel = buildSessionVotePanel(
        vote.startedById,
        vote.requiredVotes,
        currentVotes,
        completed,
    ).toJSON() as ComponentLike;
    let mediaIndex = 0;
    const visit = (node: ComponentLike): void => {
        if (node.media?.url) {
            const existingUrl = existingUrls[mediaIndex++];
            if (existingUrl) node.media.url = existingUrl;
        }
        for (const item of node.items || []) visit(item);
        for (const child of node.components || []) visit(child);
    };
    visit(panel);
    return panel;
}

/** Reads a posted V2 vote panel so a restart does not make its button dead. */
function recoverVoteFromMessage(interaction: ButtonInteraction): SessionVote | null {
    let requiredVotes = Number(interaction.customId.split(':')[3]);

    let currentVotes = 0;
    let startedById = interaction.user.id;
    const visited = new Set<ComponentLike>();
    const visit = (node: ComponentLike): void => {
        if (visited.has(node)) return;
        visited.add(node);
        const data = node.data || node;
        const customId = data.customId || data.custom_id;
        if (customId === interaction.customId && typeof data.label === 'string') {
            const count = data.label.match(/^(\d+)\/(\d+)$/);
            if (count) {
                currentVotes = Number(count[1]);
                if (!Number.isInteger(requiredVotes)) requiredVotes = Number(count[2]);
            }
        }
        if (typeof data.content === 'string') {
            const starter = data.content.match(/started by <@(\d+)>/i)?.[1];
            if (starter) startedById = starter;
        }
        for (const child of data.components || []) visit(child);
        if (data !== node) for (const child of node.components || []) visit(child);
    };
    for (const component of interaction.message.components as unknown as ComponentLike[]) visit(component);
    if (!Number.isInteger(requiredVotes) || requiredVotes < 1 || requiredVotes > MAX_VOTES) return null;

    // Discord does not expose the users who clicked a button. We retain the
    // visible count after a restart; duplicate-click protection resumes from
    // this point onward.
    return {
        guildId: interaction.guildId || '',
        channelId: interaction.channelId,
        messageId: interaction.message.id,
        startedById,
        requiredVotes,
        voters: Array.from({ length: currentVotes }, (_, index) => `recovered-${index}`),
        active: currentVotes < requiredVotes,
        // New V2 announcements include the required vote count in their ID.
        // Older announcements are still updated with their legacy action row.
        usesPanel: interaction.customId.split(':').length === 4,
    };
}

/* -------------------------------------------------------------------------- */
/*  Button handler                                                             */
/* -------------------------------------------------------------------------- */

export async function handleSessionButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'session:end:ping-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply('This button can only be used in the server where the session was posted.');
                return true;
            }
            const [member, role] = await Promise.all([
                guild.members.fetch(interaction.user.id),
                guild.roles.fetch(SESSION_PING_ROLE_ID),
            ]);
            if (!role || role.managed) {
                await interaction.editReply('The session ping role is not available right now. Please contact staff.');
                return true;
            }
            if (member.roles.cache.has(role.id)) {
                await interaction.editReply('You already have the Session Ping role.');
                return true;
            }
            await member.roles.add(role, 'Member requested the Session Ping role from a session-end announcement.');
            await interaction.editReply('✅ You now have the Session Ping role.');
        } catch (error) {
            logger.error(`[Session] Ping role button error: ${error instanceof Error ? error.message : 'Unknown'}`);
            await interaction.editReply('I could not give you the Session Ping role. Please make sure my role is above it and I have Manage Roles.');
        }
        return true;
    }

    if (!interaction.customId.startsWith('session:vote:cast')) return false;

    // A component update acknowledges the button against the original vote
    // message. This remains reliable when the process cache was rebuilt after
    // a restart and avoids Discord displaying an interaction-failed banner.
    await interaction.deferUpdate();
    const feedback = async (content: string): Promise<void> => {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    };

    try {
        const key = voteKey(interaction.guildId || '', interaction.message.id);
        await withVoteLock(key, async () => {
            let vote = activeVotes.get(key);
            if (!vote) {
                vote = recoverVoteFromMessage(interaction) || undefined;
                if (vote) activeVotes.set(key, vote);
            }

            if (!vote || !vote.active) {
                await feedback('This session vote is no longer active.');
                return;
            }

            if (vote.voters.includes(interaction.user.id)) {
                await feedback('You have already voted for this session.');
                return;
            }

            const nextVoteCount = vote.voters.length + 1;
            const completed = nextVoteCount >= vote.requiredVotes;

            if (vote.usesPanel) {
                await interaction.editReply({
                    components: [updatedVotePanel(interaction, vote, nextVoteCount, completed) as never],
                    flags: MessageFlags.IsComponentsV2,
                });
            } else {
                // Compatibility for an announcement posted before the panel
                // layout was introduced. New announcements always use V2.
                await interaction.editReply({
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        voteButton(nextVoteCount, vote.requiredVotes, completed),
                    )],
                });
            }

            vote.voters.push(interaction.user.id);
            vote.active = !completed;
            await feedback(
                completed
                    ? `✅ Your vote has been recorded! **${nextVoteCount}/${vote.requiredVotes}** votes received — the goal has been reached.`
                    : `✅ Your vote has been recorded! **${nextVoteCount}/${vote.requiredVotes}** votes received.`,
            );
        });
        return true;
    } catch (error) {
        logger.error(`[Session] Vote button error: ${error instanceof Error ? error.message : 'Unknown'}`);
        await feedback('Unable to process your vote right now. Please try again later.');
        return true;
    }
}

/* -------------------------------------------------------------------------- */
/*  Command definitions                                                        */
/* -------------------------------------------------------------------------- */

const sessionStartCommand = {
    data: new SlashCommandBuilder()
        .setName('session-start')
        .setDescription('Start a new roleplay session announcement')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = await getSessionAnnouncementChannel(interaction);
            if (!channel) {
                await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
                return;
            }

            const attachments = createSessionAttachments('start');

            await channel.send({
                components: [buildSessionStartPanel(interaction)],
                files: attachments,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID], users: [interaction.user.id] },
            });

            await interaction.editReply(`✅ Session start announcement has been posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>.`);
        } catch (error) {
            console.error('[Session] Start command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to start the session right now. Please try again later.');
        }
    },
};

const sessionVoteCommand = {
    data: new SlashCommandBuilder()
        .setName('session-vote')
        .setDescription('Start a session vote to gauge interest in joining a roleplay session')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null)
        .addIntegerOption(option =>
            option
                .setName('votes')
                .setDescription('Required number of votes needed (max 50)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_VOTES),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const requiredVotes = interaction.options.getInteger('votes', true);

            const channel = await getSessionAnnouncementChannel(interaction);
            if (!channel) {
                await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
                return;
            }

            const attachments = createSessionAttachments('vote');

            const message = await channel.send({
                components: [buildSessionVotePanel(interaction.user.id, requiredVotes, 0)],
                files: attachments,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID], users: [interaction.user.id] },
            });

            // Track the vote in memory so the button handler can update it
            activeVotes.set(voteKey(interaction.guildId || '', message.id), {
                guildId: interaction.guildId || '',
                channelId: channel.id,
                messageId: message.id,
                startedById: interaction.user.id,
                requiredVotes,
                voters: [],
                active: true,
                usesPanel: true,
            });

            await interaction.editReply(`✅ Session vote has been posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>. Required votes: **${requiredVotes}**.`);
        } catch (error) {
            console.error('[Session] Vote command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to start the session vote right now. Please try again later.');
        }
    },
};

const sessionEndCommand = {
    data: new SlashCommandBuilder()
        .setName('session-end')
        .setDescription('End a roleplay session announcement')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = await getSessionAnnouncementChannel(interaction);
            if (!channel) {
                await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
                return;
            }

            const cleanup = await deletePreviousSessionAnnouncements(channel, interaction.client.user?.id || '');
            for (const [key, vote] of activeVotes) {
                if (vote.guildId === interaction.guildId && vote.channelId === channel.id) activeVotes.delete(key);
            }
            const attachments = createSessionAttachments('end');

            await channel.send({
                components: [buildSessionEndPanel(interaction)],
                files: attachments,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID], users: [interaction.user.id] },
            });

            await interaction.editReply(
                `✅ Session end announcement has been posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>.`
                + `${cleanup.deleted ? ` Removed **${cleanup.deleted}** earlier session announcement${cleanup.deleted === 1 ? '' : 's'}.` : ''}`
                + `${cleanup.failed ? ` Warning: **${cleanup.failed}** earlier message${cleanup.failed === 1 ? '' : 's'} could not be removed.` : ''}`,
            );
        } catch (error) {
            console.error('[Session] End command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to end the session right now. Please try again later.');
        }
    },
};

const sessionBoostCommand = {
    data: new SlashCommandBuilder()
        .setName('session-boost')
        .setDescription('Announce a session boost to encourage more players to join')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = await getSessionAnnouncementChannel(interaction);
            if (!channel) {
                await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
                return;
            }

            const attachments = createSessionAttachments('boost');

            await channel.send({
                components: [buildSessionBoostPanel()],
                files: attachments,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID] },
            });

            await interaction.editReply(`✅ Session boost announcement has been posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>.`);
        } catch (error) {
            console.error('[Session] Boost command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to boost the session right now. Please try again later.');
        }
    },
};

const sessionFullCommand = {
    data: new SlashCommandBuilder()
        .setName('session-full')
        .setDescription('Announce that the current session is full')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = await getSessionAnnouncementChannel(interaction);
            if (!channel) {
                await interaction.editReply(`The session announcement channel <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}> is unavailable.`);
                return;
            }

            const attachments = createSessionAttachments('full');

            await channel.send({
                components: [buildSessionFullPanel()],
                files: attachments,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID] },
            });

            await interaction.editReply(`✅ Session full announcement has been posted in <#${SESSION_ANNOUNCEMENT_CHANNEL_ID}>.`);
        } catch (error) {
            console.error('[Session] Full command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to announce the session as full right now. Please try again later.');
        }
    },
};

export const sessionCommands = [
    sessionStartCommand,
    sessionVoteCommand,
    sessionEndCommand,
    sessionBoostCommand,
    sessionFullCommand,
];
