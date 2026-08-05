import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder, TextChannel } from 'discord.js';
import { createSessionAttachments, createSessionEmbed, SessionEmblemType } from '../utils/embeds';
import { getMelonyApiKey, getMelonyApiUrl, getInGameApiUrl } from '../config/env';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import { SessionVote as SessionVoteModel, type SessionVoteRecord } from '../database/models';

const SESSION_ROLE_ID = process.env.SESSION_ROLE_ID || '1521593407749754990';
const DEFAULT_JOIN_LINK = 'https://erlc.gg/join/LARPSRF';

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
    return `memory:${voteId}`;
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
) {
    return createSessionEmbed(title, description, color, 'vote')
        .setFields(
            { name: 'Session Status', value: title.replace('SESSION ', ''), inline: true },
            { name: 'Game', value: 'Los Angeles Roleplay', inline: true },
            { name: 'Votes needed', value: `${currentVotes}/${requiredVotes}`, inline: true },
            { name: 'Notified Role', value: `<@&${SESSION_ROLE_ID}>`, inline: true },
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

    const embed = createSessionEmbed(title, description, color, emblemType)
        .setFields(
            { name: 'Session Status', value: title.replace('SESSION ', ''), inline: true },
            { name: 'Game', value: 'Los Angeles Roleplay', inline: true },
            { name: 'Notified Role', value: `<@&${SESSION_ROLE_ID}>`, inline: true },
        );

    const attachments = createSessionAttachments(emblemType);
    const messageOptions: Record<string, unknown> = {
        embeds: [embed],
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
            .addStringOption(opt => opt.setName('summary').setDescription('Short session summary').setRequired(true))
            .addStringOption(opt => opt.setName('join-code').setDescription('The ER:LC join code (e.g. LARPSRF). Defaults to the community link if omitted.').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            const summary = interaction.options.getString('summary')?.trim() ?? 'A new session is starting now!';
            const joinCode = interaction.options.getString('join-code')?.trim();
            const inviteLink = joinCode
                ? `https://erlc.gg/join/${joinCode}`
                : (await fetchSessionInvite()) || DEFAULT_JOIN_LINK;

            await interaction.deferReply({ ephemeral: true });
            const description = summary;
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('Quick Join')
                    .setStyle(ButtonStyle.Link)
                    .setURL(inviteLink),
            );

            await postSessionAnnouncement(interaction, 'SESSION START', description, BRAND.color, 'start', false, true, row);
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
                    .setCustomId('session:notify')
                    .setLabel('🔔 Sessions')
                    .setStyle(ButtonStyle.Primary),
            );
            await postSessionAnnouncement(interaction, 'SESSION END', description, 0xef4444, 'end', true, false, row);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-vote')
            .setDescription('Start a vote to open a new session')
            .addStringOption(opt => opt.setName('summary').setDescription('Short vote summary').setRequired(false)),
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

            const summary = interaction.options.getString('summary')?.trim() ?? 'Vote now to start the next session!';
            const requiredVotes = chooseRequiredVotes(interaction);
            const description = `${summary}\n\n**Votes needed:** ${requiredVotes}`;
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
                embeds: [createSessionVoteEmbed('SESSION VOTE', description, BRAND.color, 0, requiredVotes)],
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
                    createSessionEmbed('SESSION VOTE', `Current votes: ${voteRecord.voters.length}/${voteRecord.requiredVotes}`, BRAND.color, 'vote')
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
            await postSessionAnnouncement(interaction, 'SESSION FULL', reason, 0xf59e0b, 'full');
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-boost')
            .setDescription('Announce a session boost or special event')
            .addStringOption(opt => opt.setName('details').setDescription('Boost details').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const details = interaction.options.getString('details')?.trim() ?? 'A session boost is active now!';
            await postSessionAnnouncement(interaction, 'SESSION BOOST', details, 0x8b5cf6, 'boost');
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
        `Vote now to start the next session!\n\n**Votes needed:** ${voteRecord.requiredVotes}`,
        BRAND.color,
        currentVotes,
        voteRecord.requiredVotes,
    );

    const message = await interaction.message.fetch();
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
    if (interaction.customId !== 'session:notify') return false;
    if (!interaction.inGuild() || !interaction.guild) return false;

    const roleId = process.env.SESSION_ROLE_ID || '1521593407749754990';
    const guildMember = interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!guildMember) {
        await interaction.reply({ content: 'Unable to assign the session notification role right now.', ephemeral: true });
        return true;
    }

    if (guildMember.roles.cache.has(roleId)) {
        await interaction.reply({ content: 'You already have session notifications enabled.', ephemeral: true });
        return true;
    }

    try {
        await guildMember.roles.add(roleId);
        await interaction.reply({ content: 'You have been added to session notifications.', ephemeral: true });
    } catch {
        await interaction.reply({ content: 'Unable to assign the session notification role. Please check your server permissions.', ephemeral: true });
    }

    return true;
}

export default sessionCommands;
