import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { createSessionAttachment, createSessionEmbed } from '../utils/embeds';
import { getMelonyApiKey, getMelonyApiUrl, getInGameApiUrl } from '../config/env';
import { BRAND, CHANNEL_IDS } from '../config/constants';

const SESSION_ROLE_ID = '1521593407749754990';

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
    const sessionTitles = new Set(['SESSION START', 'SESSION END', 'SESSION FULL', 'SESSION BOOST']);
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
    clearPrevious = false,
): Promise<void> {
    const announcementChannel = await interaction.client.channels.fetch(CHANNEL_IDS.sessionAnnouncements).catch(() => null);
    if (!announcementChannel || !announcementChannel.isTextBased()) {
        await interaction.reply({ content: 'Unable to post session announcement: announcement channel not available.', ephemeral: true });
        return;
    }

    const channel = announcementChannel as TextChannel;
    if (clearPrevious) await cleanupPreviousSessionMessages(channel);

    const embed = createSessionEmbed(title, description, color)
        .setFields(
            { name: 'Session Status', value: title.replace('SESSION ', ''), inline: true },
            { name: 'Notified Role', value: `<@&${SESSION_ROLE_ID}>`, inline: true },
            { name: 'Game', value: 'Los Angeles Roleplay', inline: true },
        );

    const attachment = createSessionAttachment();
    await channel.send({
        content: `<@&${SESSION_ROLE_ID}>`,
        embeds: [embed],
        files: attachment ? [attachment] : [],
        allowedMentions: { roles: [SESSION_ROLE_ID] },
    }).catch(() => undefined);

    await interaction.reply({ content: 'Session announcement posted successfully.', ephemeral: true });
}

const sessionCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('session-start')
            .setDescription('Announce a new session start with an embedded join link')
            .addStringOption(opt => opt.setName('summary').setDescription('Short session summary').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const summary = interaction.options.getString('summary')?.trim() ?? 'A new session is starting now!';
            const inviteLink = await fetchSessionInvite();
            const description = inviteLink
                ? `${summary}\n\n**Join the game:** [Click here to join](${inviteLink})`
                : `${summary}\n\n*Unable to fetch the join link automatically. Please contact staff if you need it.*`;

            await postSessionAnnouncement(interaction, 'SESSION START', description, BRAND.color);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-end')
            .setDescription('Announce that the current session has ended')
            .addStringOption(opt => opt.setName('reason').setDescription('Reason or summary of session end').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            const reason = interaction.options.getString('reason')?.trim() ?? 'The session is currently down, do not join under any circumstances.';
            await postSessionAnnouncement(interaction, 'SESSION END', reason, 0xef4444, true);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-full')
            .setDescription('Announce that the session is full and cannot take new players')
            .addStringOption(opt => opt.setName('reason').setDescription('Additional note').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            const reason = interaction.options.getString('reason')?.trim() ?? 'The session is full right now. Please wait for the next one.';
            await postSessionAnnouncement(interaction, 'SESSION FULL', reason, 0xf59e0b);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('session-boost')
            .setDescription('Announce a session boost or special event')
            .addStringOption(opt => opt.setName('details').setDescription('Boost details').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const details = interaction.options.getString('details')?.trim() ?? 'A session boost is active now!';
            await postSessionAnnouncement(interaction, 'SESSION BOOST', details, 0x8b5cf6);
        },
    },
];

export default sessionCommands;
