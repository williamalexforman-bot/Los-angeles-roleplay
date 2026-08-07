import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder, TextChannel } from 'discord.js';
import { createSessionAttachments, createSessionEmbed, resolveTopBannerUrl, SessionEmblemType } from '../utils/embeds';
import { getMelonyApiKey, getMelonyApiUrl, getInGameApiUrl } from '../config/env';
import { CHANNEL_IDS } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import { SessionVote as SessionVoteModel, type SessionVoteRecord } from '../database/models';

const SESSION_ROLE_ID = process.env.SESSION_ROLE_ID || '1521593407749754990';
const SESSION_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
const GAME = 'Los Angeles Roleplay';
const DEFAULT_JOIN_LINK = 'https://erlc.gg/join/LARPSRF';

// Embed colors for each session type. All use the LA Roleplay Orange accent (#FF7A00).
const SESSION_COLORS = {
    start: 0xff7a00,
    end: 0xff7a00,
    full: 0xff7a00,
    boost: 0xff7a00,
    vote: 0xff7a00,
} as const;

interface InMemorySessionVote {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    startedAt: Date;
    active: boolean;
    requiredVotes: number;
    voters: Array<{ userId: string; username: string; votedAt: Date }>;
}

const inMemorySessionVotes = new Map<string, InMemorySessionVote>();
const inMemoryActiveVoteByGuild = new Map<string, string>();

function sessionVoteId(voteId: string): string {
    // No colon separators so the custom-id parser (split(':')) works reliably.
    return `mem_${voteId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function chooseRequiredVotes(interaction: ChatInputCommandInteraction): number {
    const memberCount = interaction.guild?.memberCount ?? 50;
    const calculated = Math.ceil(memberCount * 0.2);
    return Math.max(5, Math.min(18, calculated));
}

function createSessionVoteEmbed(
    title: string,
    description: string,
    color: number,
    currentVotes: number,
    requiredVotes: number,
    startedAt: Date = new Date(),
) {
    const startedUnix = Math.floor(startedAt.getTime() / 1000);
    return createSessionEmbed(title, description, color, 'vote')
        .setFooter({ text: `${SESSION_FOOTER}` })
        .setFields(
            { name: 'Session Status', value: 'VOTE', inline: true },
            { name: 'Votes Needed', value: `${currentVotes}/${requiredVotes}`, inline: true },
            { name: 'Voting Started', value: `<t:${startedUnix}:R>`, inline: true },
        );
}

function extractSessionInvite(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const candidate = record.invite ?? record.joinUrl ?? record.link ?? record.url ?? record.gameInvite;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    return null;
}

async function tryFetchInvite(url: string, apiKey: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: apiKey,
            },
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return extractSessionInvite(payload);
    } catch {
        return null;
    }
}

async function fetchSessionInvite(): Promise<string | null> {
    const apiKey = getMelonyApiKey();
    if (!apiKey) return null;

    const urls = [getMelonyApiUrl(), 'https://api.melony.gg/server', getInGameApiUrl()]
        .filter((url): url is string => Boolean(url));

    for (const url of urls) {
        const invite = await tryFetchInvite(url, apiKey);
        if (invite) return invite;
    }
    return null;
}

async function cleanupPreviousSessionMessages(channel: TextChannel): Promise<void> {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sessionTitles = new Set(['SESSION START', 'SESSION END', 'SESSION FULL', 'SESSION BOOST', 'SESSION VOTE']);
    await Promise.all(messages.map(async message => {
        if (message.author.id !== message.client.user?.id) return;
        const embedTitle = message.embeds[0]?.title;
        if (embedTitle && sessionTitles.has(embedTitle)) {
            await message.delete().catch(() => undefined);
        }
    }));
}

async function postSessionAnnouncement(
    interaction: ChatInputCommandInteraction,
    title: string,
    description: string,
    color: number,
    emblemType: SessionEmblemType,
    clearPrevious = false,
    mentionRole = true,
    row?: ActionRowBuilder<ButtonBuilder>,
): Promise<void> {
    const announcementChannel = await interaction.client.channels.fetch(CHANNEL_IDS.sessionAnnouncements).catch(() => null);
    if (!announcementChannel || !announcementChannel.isTextBased()) {
        await interaction.reply({ content: 'Unable to post session announcement: announcement channel not available.', ephemeral: true });
        return;
    }

    const channel = announcementChannel as TextChannel;
    if (clearPrevious) await cleanupPreviousSessionMessages(channel);

const status = title.replace('SESSION ', '').trim();

// Main top embed: title/author, combined banner image (top banner + underbanner
    // composited into ONE image), description, fields, text-only footer.
    const embed = createSessionEmbed(title, description, color, emblemType)
        .setFooter({ text: SESSION_FOOTER })
        .setFields(
            { name: 'Session Status', value: status, inline: true },
            { name: 'Game', value: GAME, inline: true },
            { name: 'Notified Role', value: `<@&${SESSION_ROLE_ID}>`, inline: true },
        );

    // Single-embed layout: [mainEmbed] — the combined banner already contains the
    // top banner at the top and the underbanner at the bottom.
    const embeds = [embed];
    const attachments = createSessionAttachments(emblemType);
    const messageOptions: Record<string, unknown> = {
        embeds,
        files: attachments,
        components: row ? [row] : [],
        allowedMentions: { roles: [SESSION_ROLE_ID] },
    };
    if (mentionRole) {
        messageOptions.content = `<@&${SESSION_ROLE_ID}>`;
    }

    await channel.send(messageOptions).catch(() => undefined);

    await interaction.reply({ content: 'Session announcement posted successfully.', ephemeral: true });
}

const sessionCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('session-start')
            .setDescription('Announce a new session start with an embedded join link')
            .addStringOption(opt => opt.setName('join-code').setDescription('The ER:LC join code (e.g. LARPSRF). Defaults to the community link if omitted.').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            const joinCode = interaction.options.getString('join-code')?.trim();
            const inviteLink = joinCode
                ? `https://erlc.gg/join/${joinCode}`
: (await fetchSessionInvite()) || DEFAULT_JOIN_LINK;

            await interaction.deferReply({ ephemeral: true });
            const description = 'Do you want to join our current session? Join the game using the link below!';
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('Quick Join')
                    .setStyle(ButtonStyle.Link)
                    .setURL(inviteLink),
            );

            await postSessionAnnouncement(interaction, 'SESSION START', description, SESSION_COLORS.start, 'start', false, true, row);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-end')
            .setDescription('Announce that the current session has ended'),
async execute(interaction: ChatInputCommandInteraction) {
            const description = 'Do you want to be notified for our next session? If so click the button below!';
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_notify_role')
                    .setLabel('🔔 Sessions')
                    .setStyle(ButtonStyle.Primary),
            );
            await postSessionAnnouncement(interaction, 'SESSION END', description, SESSION_COLORS.end, 'end', true, false, row);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-vote')
            .setDescription('Start a vote to open a new session')
            .addIntegerOption(opt => opt
                .setName('vote-amounts')
                .setDescription('Vote amounts required to start the session (1-50)')
                .setMinValue(1)
                .setMaxValue(50)
                .setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            await interaction.deferReply({ ephemeral: true });
            if (!interaction.guildId || !interaction.guild) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            const existingVote = isDatabaseAvailable()
                ? await SessionVoteModel.findOne({ guildId: interaction.guildId, active: true }).exec()
                : inMemorySessionVotes.get(inMemoryActiveVoteByGuild.get(interaction.guildId) ?? '');
            if (existingVote) {
                await interaction.editReply('There is already an active session vote. Use /view-votes to view who has voted.');
                return;
            }

            const requiredVotes = interaction.options.getInteger('vote-amounts') ?? chooseRequiredVotes(interaction);
            const description = 'Session voting has started! If you vote, you are required to join in-game within 15 minutes after it starts.';
            const placeholderId = `session:vote:placeholder:${Date.now()}`;
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(placeholderId)
                    .setLabel('Vote to start session')
                    .setEmoji('🗳️')
                    .setStyle(ButtonStyle.Primary),
            );

            const announcementChannel = await interaction.client.channels.fetch(CHANNEL_IDS.sessionAnnouncements).catch(() => null);
            if (!announcementChannel || !announcementChannel.isTextBased()) {
                await interaction.editReply('Unable to post session vote: announcement channel not available.');
                return;
            }

            const channel = announcementChannel as TextChannel;
            await cleanupPreviousSessionMessages(channel);

const message = await channel.send({
                content: `<@&${SESSION_ROLE_ID}>`,
                embeds: [createSessionVoteEmbed('SESSION VOTE', description, SESSION_COLORS.vote, 0, requiredVotes)],
                components: [row],
                files: createSessionAttachments('vote'),
                allowedMentions: { roles: [SESSION_ROLE_ID] },
            }).catch(() => null);

            if (!message) {
                await interaction.editReply('Unable to post the session vote announcement.');
                return;
            }

            const voteData: InMemorySessionVote = {
                id: `vote-${message.id}`,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                messageId: message.id,
                startedById: interaction.user.id,
                startedAt: new Date(),
                active: true,
                requiredVotes,
                voters: [],
            };

            if (isDatabaseAvailable()) {
                const savedVote = new SessionVoteModel({
                    guildId: voteData.guildId,
                    channelId: voteData.channelId,
                    messageId: voteData.messageId,
                    startedById: voteData.startedById,
                    startedAt: voteData.startedAt,
                    active: voteData.active,
                    requiredVotes: voteData.requiredVotes,
                    voters: voteData.voters,
                });
                await savedVote.save();
                const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`session:vote:${savedVote._id}`)
                        .setLabel('Vote to start session')
                        .setEmoji('🗳️')
                        .setStyle(ButtonStyle.Primary),
                );
                await message.edit({ components: [updatedRow] });
                inMemoryActiveVoteByGuild.set(interaction.guildId, sessionVoteId(savedVote._id.toString()));
                inMemorySessionVotes.set(sessionVoteId(savedVote._id.toString()), voteData);
            } else {
                const memoryId = sessionVoteId(voteData.id);
                inMemorySessionVotes.set(memoryId, voteData);
                inMemoryActiveVoteByGuild.set(interaction.guildId, memoryId);
                const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`session:vote:${memoryId}`)
                        .setLabel('Vote to start session')
                        .setEmoji('🗳️')
                        .setStyle(ButtonStyle.Primary),
                );
                await message.edit({ components: [updatedRow] });
            }

            await interaction.editReply('✅ Session vote started successfully.');
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('view-votes')
            .setDescription('View the current session vote and who has voted'),
        async execute(interaction: ChatInputCommandInteraction) {
            await interaction.deferReply({ ephemeral: true });
            if (!interaction.guildId) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            let voteRecord: SessionVoteRecord | InMemorySessionVote | null = null;
            if (isDatabaseAvailable()) {
                voteRecord = await SessionVoteModel.findOne({ guildId: interaction.guildId, active: true }).exec();
            }
            if (!voteRecord) {
                const memoryId = inMemoryActiveVoteByGuild.get(interaction.guildId);
                if (memoryId) voteRecord = inMemorySessionVotes.get(memoryId) ?? null;
            }

            if (!voteRecord) {
                await interaction.editReply('There is no active session vote right now.');
                return;
            }

            const votersList = voteRecord.voters.length > 0
                ? voteRecord.voters.map(v => `<@${v.userId}>`).join('\n')
                : 'No votes yet.';

            await interaction.editReply({
                embeds: [
createSessionEmbed('SESSION VOTE', `Current votes: ${voteRecord.voters.length}/${voteRecord.requiredVotes}`, SESSION_COLORS.vote, 'vote')
                        .addFields(
                            { name: 'Started by', value: `<@${voteRecord.startedById}>`, inline: true },
                            { name: 'Votes needed', value: `${voteRecord.requiredVotes}`, inline: true },
                            { name: 'Voters', value: votersList.slice(0, 1024), inline: false },
                        ),
                ],
            });
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-full')
            .setDescription('Announce that the session is full and cannot take new players')
            .addStringOption(opt => opt.setName('reason').setDescription('Additional note').setRequired(false)),
async execute(interaction: ChatInputCommandInteraction) {
            const reason = interaction.options.getString('reason')?.trim() ?? 'The session is full right now. Please wait for the next one.';
            await postSessionAnnouncement(interaction, 'SESSION FULL', reason, SESSION_COLORS.full, 'full');
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-boost')
            .setDescription('Announce a session boost or special event')
            .addStringOption(opt => opt.setName('details').setDescription('Boost details').setRequired(true)),
async execute(interaction: ChatInputCommandInteraction) {
            const details = interaction.options.getString('details')?.trim() ?? 'A session boost is active now!';
            await postSessionAnnouncement(interaction, 'SESSION BOOST', details, SESSION_COLORS.boost, 'boost');
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-role')
            .setDescription('Manage the session notification role')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add the session notification role to a user')
                    .addUserOption(option => option.setName('user').setDescription('The user to add the session role to').setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Remove the session notification role from a user')
                    .addUserOption(option => option.setName('user').setDescription('The user to remove the session role from').setRequired(true))),
        async execute(interaction: ChatInputCommandInteraction) {
            const subcommand = interaction.options.getSubcommand();
            const user = interaction.options.getUser('user');
            if (!user) {
                return interaction.reply({ content: 'Unable to resolve that user.', ephemeral: true });
            }

            const member = interaction.guild?.members.cache.get(user.id) as GuildMember | undefined;
            if (!member) {
                return interaction.reply({ content: 'That user is not a member of this server.', ephemeral: true });
            }

            try {
                if (subcommand === 'add') {
                    await member.roles.add(SESSION_ROLE_ID);
                    await interaction.reply({ content: `Added the session notification role to ${user.username}.`, ephemeral: true });
                } else {
                    await member.roles.remove(SESSION_ROLE_ID);
                    await interaction.reply({ content: `Removed the session notification role from ${user.username}.`, ephemeral: true });
                }
            } catch {
                await interaction.reply({ content: 'Failed to update the session notification role. Please check the role and bot permissions.', ephemeral: true });
            }
        },
    },
];

export async function handleSessionVoteButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('session:vote:')) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const voteId = interaction.customId.split(':')[2];
    const dbVote = isDatabaseAvailable() ? await SessionVoteModel.findById(voteId).exec() : null;
    const memoryVote = !dbVote ? inMemorySessionVotes.get(voteId) : null;
    const voteRecord = dbVote ?? memoryVote;

    if (!voteRecord || !voteRecord.active) {
        await interaction.editReply('This session vote is no longer active.');
        return true;
    }

    if (voteRecord.voters.some(v => v.userId === interaction.user.id)) {
        await interaction.editReply('You have already voted for this session.');
        return true;
    }

    const voter = { userId: interaction.user.id, username: interaction.user.username, votedAt: new Date() };
    voteRecord.voters.push(voter);

if (dbVote) {
        dbVote.voters = voteRecord.voters;
        await dbVote.save();
    }

    const currentVotes = voteRecord.voters.length;
    const embed = createSessionVoteEmbed(
        'SESSION VOTE',
'Session voting has started! If you vote, you are required to join in-game within 15 minutes after it starts.',
        SESSION_COLORS.vote,
        currentVotes,
        voteRecord.requiredVotes,
    );

const message = await interaction.message.fetch();
    // Single combined banner embed — matches the initial vote message layout.
    await message.edit({ embeds: [embed] }).catch(() => undefined);

    if (!memoryVote && !dbVote) {
        // no-op, just safety
    } else if (memoryVote) {
        inMemorySessionVotes.set(voteId, memoryVote);
    }

    await interaction.editReply(`✅ Your vote has been counted. (${currentVotes}/${voteRecord.requiredVotes})`);
    return true;
}

export async function handleSessionNotifyButton(interaction: import('discord.js').ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'claim_notify_role') return false;
    if (!interaction.inGuild() || !interaction.guild) return false;

    const roleId = '1521593407749754990';
    const guildMember = interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!guildMember) {
        await interaction.reply({ content: 'Unable to assign the session notification role right now.', ephemeral: true });
        return true;
    }

    if (guildMember.roles.cache.has(roleId)) {
        try {
            await guildMember.roles.remove(roleId);
            await interaction.reply({ content: 'Removed the session notification role!', ephemeral: true });
        } catch {
            await interaction.reply({ content: 'Unable to update the session notification role. Please check your server permissions.', ephemeral: true });
        }
        return true;
    }

    try {
        await guildMember.roles.add(roleId);
        await interaction.reply({ content: 'You will now be notified for future sessions!', ephemeral: true });
    } catch {
        await interaction.reply({ content: 'Unable to assign the session notification role. Please check your server permissions.', ephemeral: true });
    }

    return true;
}

export default sessionCommands;
