import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import {
    createSessionEmbed,
    createUnderbannerEmbed,
    createSessionAttachments,
    SESSION_ACCENT_COLOR,
    type SessionEmblemType,
} from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { logger } from '../utils/logger';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ERLC_JOIN_URL = 'https://erlc.gg/join?code=LARNRPP&placeId=2534724415';
const ERLC_GAME_CODE = 'LARNRPP';
const MAX_VOTES = 50;

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
}

const activeVotes: Map<string, SessionVote> = new Map();

function voteKey(guildId: string, messageId: string): string {
    return `${guildId}:${messageId}`;
}

/* -------------------------------------------------------------------------- */
/*  Embed builders                                                             */
/* -------------------------------------------------------------------------- */

function buildSessionStartEmbed(interaction: ChatInputCommandInteraction): EmbedBuilder {
    const description = [
        `A session has been started by <@${interaction.user.id}>.`,
        '',
        `To join please click the button below or go to ERLC and enter code **${ERLC_GAME_CODE}**.`,
    ].join('\n');

    return createSessionEmbed(
        'SESSION START',
        description,
        SESSION_ACCENT_COLOR,
        'start',
    );
}

function buildSessionVoteEmbed(
    interaction: ChatInputCommandInteraction,
    requiredVotes: number,
    currentVotes: number,
): EmbedBuilder {
    const description = [
        `**A session vote has been started by <@${interaction.user.id}> please vote to join.**`,
        '',
        '**NOTE IF YOU VOTE YOU MUST JOIN!**',
    ].join('\n');

    return createSessionEmbed(
        'SESSION VOTE',
        description,
        SESSION_ACCENT_COLOR,
        'vote',
    );
}

function buildSessionEndEmbed(interaction: ChatInputCommandInteraction): EmbedBuilder {
    const description = `A session has been ended by <@${interaction.user.id}>.`;
    return createSessionEmbed(
        'SESSION END',
        description,
        SESSION_ACCENT_COLOR,
        'end',
    );
}

function buildSessionBoostEmbed(interaction: ChatInputCommandInteraction): EmbedBuilder {
    const description = `A session boost has been started by <@${interaction.user.id}>.`;
    return createSessionEmbed(
        'SESSION BOOST',
        description,
        SESSION_ACCENT_COLOR,
        'boost',
    );
}

function buildSessionFullEmbed(interaction: ChatInputCommandInteraction): EmbedBuilder {
    const description = `The session is now full. Started by <@${interaction.user.id}>.`;
    return createSessionEmbed(
        'SESSION FULL',
        description,
        SESSION_ACCENT_COLOR,
        'full',
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

function voteButton(currentVotes: number, requiredVotes: number): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`session:vote:cast`)
        .setLabel(`${currentVotes}/${requiredVotes}`)
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success);
}

/* -------------------------------------------------------------------------- */
/*  Button handler                                                             */
/* -------------------------------------------------------------------------- */

export async function handleSessionButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('session:vote:')) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const key = voteKey(interaction.guildId || '', interaction.message.id);
        const vote = activeVotes.get(key);

        if (!vote || !vote.active) {
            await interaction.editReply('This session vote is no longer active.');
            return true;
        }

        if (vote.voters.includes(interaction.user.id)) {
            await interaction.editReply('You have already voted for this session.');
            return true;
        }

        vote.voters.push(interaction.user.id);

        // Update the button label to reflect the new vote count
        const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            voteButton(vote.voters.length, vote.requiredVotes),
        );

        const message = interaction.message;
        if (message.editable) {
            await message.edit({ components: [updatedRow] });
        }

        await interaction.editReply(`✅ Your vote has been recorded! **${vote.voters.length}/${vote.requiredVotes}** votes received.`);
        return true;
    } catch (error) {
        logger.error(`[Session] Vote button error: ${error instanceof Error ? error.message : 'Unknown'}`);
        await interaction.editReply('Unable to process your vote right now. Please try again later.');
        return true;
    }
}

/* -------------------------------------------------------------------------- */
/*  Command definitions                                                        */
/* -------------------------------------------------------------------------- */

const sessionStartCommand = {
    data: new SlashCommandBuilder()
        .setName('session-start')
        .setDescription('Start a new roleplay session announcement'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.editReply('This channel cannot receive the session announcement.');
                return;
            }

            const embed = buildSessionStartEmbed(interaction);
            const underbanner = createUnderbannerEmbed();
            const attachments = createSessionAttachments('start');

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinSessionButton());

            await channel.send({
                embeds: [embed, underbanner],
                components: [row],
                files: attachments,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply('✅ Session start announcement has been posted in this channel.');
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

            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.editReply('This channel cannot receive the session vote.');
                return;
            }

            const embed = buildSessionVoteEmbed(interaction, requiredVotes, 0);
            const underbanner = createUnderbannerEmbed();
            const attachments = createSessionAttachments('vote');

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                voteButton(0, requiredVotes),
            );

            const message = await channel.send({
                embeds: [embed, underbanner],
                components: [row],
                files: attachments,
                allowedMentions: { parse: [] },
            });

            // Track the vote in memory so the button handler can update it
            activeVotes.set(voteKey(interaction.guildId || '', message.id), {
                guildId: interaction.guildId || '',
                channelId: interaction.channelId,
                messageId: message.id,
                startedById: interaction.user.id,
                requiredVotes,
                voters: [],
                active: true,
            });

            await interaction.editReply(`✅ Session vote has been posted in this channel. Required votes: **${requiredVotes}**.`);
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
        .setDescription('End a roleplay session announcement'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.editReply('This channel cannot receive the session announcement.');
                return;
            }

            const embed = buildSessionEndEmbed(interaction);
            const underbanner = createUnderbannerEmbed();
            const attachments = createSessionAttachments('end');

            await channel.send({
                embeds: [embed, underbanner],
                files: attachments,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply('✅ Session end announcement has been posted in this channel.');
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
        .setDescription('Announce a session boost to encourage more players to join'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.editReply('This channel cannot receive the session boost announcement.');
                return;
            }

            const embed = buildSessionBoostEmbed(interaction);
            const underbanner = createUnderbannerEmbed();
            const attachments = createSessionAttachments('boost');

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinSessionButton());

            await channel.send({
                embeds: [embed, underbanner],
                components: [row],
                files: attachments,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply('✅ Session boost announcement has been posted in this channel.');
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
        .setDescription('Announce that the current session is full'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.editReply('This channel cannot receive the session full announcement.');
                return;
            }

            const embed = buildSessionFullEmbed(interaction);
            const underbanner = createUnderbannerEmbed();
            const attachments = createSessionAttachments('full');

            await channel.send({
                embeds: [embed, underbanner],
                files: attachments,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply('✅ Session full announcement has been posted in this channel.');
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
