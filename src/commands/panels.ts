import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    Guild,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    parseEmoji,
} from 'discord.js';
import { BRAND, CHANNEL_IDS, TICKET_STAFF_ROLE_ID } from '../config/constants';
import { bannerAttachment, bannerFiles, bannerUrl } from '../utils/bannerAssets';
import { postOrUpdateTicketPanel } from './tickets';
import { fetchErlcServer } from '../services/erlcService';
import {
    applyTemplate,
    configuredChannelId,
    DEFAULT_PANEL_CONFIGS,
    getPanelBannerUrl,
    getPanelConfig,
    getGuildBotConfig,
    getSessionState,
    parseEmojiMap,
    parseSessionEmojis,
    registerSessionPanel,
    replaceSessionPanelReferences,
    setSessionState,
    type PanelConfig,
    type SessionLifecycleStatus,
} from '../services/panelConfig';

const QUICK_JOIN_URL = 'https://www.roblox.com/games/start?launchData=%7B%22psCode%22%3A%22califorp%22%7D&placeId=2534724415';
const DASHBOARD_MENU_ID = 'dashboard:menu';
const REGULATIONS_MENU_ID = 'regulations:menu';
const SESSION_TITLE_EMOJI = '<:session:1525234122568765710>';
const REGULATIONS_TITLE_EMOJI = '<:regulations:1516784266556604528>';
const STAFF_GUIDE_URL = 'https://docs.google.com/document/d/11Bjkf1bEO7SxECUPtq4aSl2AFC_0zZfjHngHDl5_0GU/edit?usp=drivesdk';
const DASHBOARD_BANNER_URL = 'https://cdn.phototourl.com/member/2026-09-30-8c447076-7d6b-4eee-8399-ba3d4b1552b3.webp';
const INFORMATION_BANNER_URL = 'https://cdn.phototourl.com/member/2026-09-30-328a9e05-2d30-4a75-affc-fc78bdf2b8cb.png';
const REGULATIONS_BANNER_URL = 'https://cdn.phototourl.com/member/2026-09-30-19c5f496-ed7f-4403-b258-139fd3808761.webp';
const PANEL_UNDERBANNER_URL = 'https://cdn.phototourl.com/member/2026-09-30-85572d76-a26b-477a-860a-21d51aa8f6f2.webp';

const DISCORD_RULES = `# Discord Rules

1. Swearing is permitted, but you may not direct it at another person. Keep swearing to a minimum, and **no slurs are allowed**.

2) Treat all staff members and community members with respect. We strive to maintain a welcoming and respectful community.

3. Self-promotion, advertising, and spam are not permitted and will result in punishment.

4) Use the appropriate channels for their intended purpose (e.g. use the **#commands** channel for bot commands).

5. Follow Discord's Terms of Service at all times. Failure to do so will result in severe punishment.

6) Staff reserve the right to enforce unlisted rules if they believe it is in the best interest of the server. If you disagree with a staff member's decision, you may report it through the appropriate channels.`;

const GAME_RULES = `# In-Game Rules

1. If you vote in favor of a session, you are expected to join. Failure to do so may result in severe punishment.

2) Violating roleplay rules such as **RDM, VDM, NLR**, or similar offenses will result in punishment. If you are unsure what these terms mean, please open a support ticket.

3. Disrespecting staff while they are on duty is not permitted and may result in punishment.

4) Proper roleplay is expected at all times. Do your best to create an enjoyable and realistic experience for everyone.

5. Follow Roblox's Terms of Service at all times. Failure to do so will result in severe punishment.

6) Staff may punish unlisted rule violations if they are deemed severe enough. If you disagree with a staff member's decision, you may report it through the appropriate channels.`;

function gallery(url: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(url),
    );
}

function safeEmoji(value: string | undefined, fallback: string): string {
    const emoji = value?.trim();
    if (!emoji) return fallback;
    if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(emoji)) return emoji;
    // Reject plain words and malformed custom emoji before Discord validates the payload.
    if (/^[A-Za-z0-9_-]+$/.test(emoji)) return fallback;
    return emoji;
}

function addButtonEmoji(button: ButtonBuilder, value: string | undefined, fallback: string): ButtonBuilder {
    try { return button.setEmoji(safeEmoji(value, fallback)); } catch { return button; }
}

function panelFooter(label: string): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(`-# California State Roleplay • ${label} • Realism at its Finest`);
}

function staffGuidePanel(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = parseEmojiMap(config.emojiText);
    const values = { server: 'California State Roleplay' };
    const button = addButtonEmoji(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(STAFF_GUIDE_URL).setLabel('Open Staff Guide'),
        emojis.guide,
        '📖',
    );
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('staffGuide')))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${safeEmoji(emojis.title, '🛡️')} ${applyTemplate(config.title, values)}`,
            applyTemplate(config.description, values),
        ].join('\n\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## The CSRP Standard',
            '**Professionalism** — Stay calm, fair, and respectful in every situation.',
            '**Responsibility** — Use staff tools only for their intended purpose and document important actions.',
            '**Teamwork** — Ask a higher-ranking staff member for guidance whenever a situation is unclear.',
            '',
            '> Staff members represent CSRP at all times. Read the complete guide before beginning staff duties.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button))
        .addTextDisplayComponents(panelFooter('Staff Resources'))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

function loadingSessionPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${SESSION_TITLE_EMOJI} Session Information\n> Loading the latest session information…`),
        );
}

interface SessionDisplayStatus {
    lifecycle: SessionLifecycleStatus;
    staff: number;
    players: number;
    maximum: number;
    queue: number;
    updatedAt: number;
}

function lifecycleDisplay(status: SessionLifecycleStatus): { label: string; style: ButtonStyle; emoji: keyof ReturnType<typeof parseSessionEmojis> } {
    if (status === 'online') return { label: 'Session Online', style: ButtonStyle.Success, emoji: 'online' };
    if (status === 'boosted') return { label: 'Session Boosted', style: ButtonStyle.Success, emoji: 'boost' };
    if (status === 'voting') return { label: 'Session Vote Open', style: ButtonStyle.Secondary, emoji: 'vote' };
    return { label: 'Session Offline', style: ButtonStyle.Danger, emoji: 'offline' };
}

function sessionPanel(
    status: SessionDisplayStatus,
    configured: PanelConfig,
    customBannerUrl?: string | null,
): ContainerBuilder {
    const emojis = parseSessionEmojis(configured.emojiText);
    const values = {
        updated: `<t:${Math.floor(status.updatedAt / 1_000)}:R>`,
        staff: String(status.staff),
        players: String(status.players),
        maximum: String(status.maximum),
        queue: String(status.queue),
        status: lifecycleDisplay(status.lifecycle).label.replace('Session ', ''),
    };
    const information = new TextDisplayBuilder().setContent([
        `# ${safeEmoji(emojis.title, SESSION_TITLE_EMOJI)} ${applyTemplate(configured.title, values)}`,
        applyTemplate(configured.description, values),
        '',
        `> **Current Status:** ${lifecycleDisplay(status.lifecycle).label}`,
        `> **Last Updated:** <t:${Math.floor(status.updatedAt / 1_000)}:R>`,
    ].join('\n'));

    const counters = new ActionRowBuilder<ButtonBuilder>().addComponents(
        addButtonEmoji(new ButtonBuilder()
            .setCustomId('session:staff-count')
            .setLabel(`Staff Online: ${status.staff}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.staff, '👥'),
        addButtonEmoji(new ButtonBuilder()
            .setCustomId('session:player-count')
            .setLabel(`Players In-Game: ${status.players}/${status.maximum}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.players, '👤'),
        addButtonEmoji(new ButtonBuilder()
            .setCustomId('session:queue-count')
            .setLabel(`In Queue: ${status.queue}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.queue, '🕒'),
    );

    const display = lifecycleDisplay(status.lifecycle);
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        addButtonEmoji(new ButtonBuilder()
            .setCustomId('session:status')
            .setLabel(display.label)
            .setStyle(display.style)
            .setDisabled(true), emojis[display.emoji], display.emoji === 'offline' ? '🔴' : '🟢'),
        new ButtonBuilder()
            .setLabel('Quick Join')
            .setStyle(ButtonStyle.Link)
            .setURL(QUICK_JOIN_URL),
    );

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('session')))
        .addTextDisplayComponents(information)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(counters, controls)
        .addTextDisplayComponents(panelFooter('Live Session Center'))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

async function currentSessionDisplay(guild: Guild): Promise<SessionDisplayStatus> {
    const [state, snapshot] = await Promise.all([
        getSessionState(guild),
        fetchErlcServer({ timeoutMs: 10_000 }),
    ]);
    const active = state.status === 'online' || state.status === 'boosted';
    if (snapshot.ok && active) {
        return {
            lifecycle: state.status,
            staff: snapshot.data.players.filter(player => player.permission.toLowerCase() !== 'normal').length,
            players: snapshot.data.currentPlayers,
            maximum: snapshot.data.maxPlayers,
            queue: Math.max(0, snapshot.data.currentPlayers - snapshot.data.maxPlayers),
            updatedAt: state.updatedAt || snapshot.data.fetchedAt,
        };
    }
    return {
        lifecycle: state.status,
        staff: 0,
        players: 0,
        maximum: snapshot.ok ? snapshot.data.maxPlayers : 40,
        queue: 0,
        updatedAt: state.updatedAt || Date.now(),
    };
}

export async function refreshSavedSessionPanels(guild: Guild): Promise<number> {
    const [guildConfig, configured, status] = await Promise.all([
        getGuildBotConfig(guild),
        getPanelConfig(guild, 'session'),
        currentSessionDisplay(guild),
    ]);
    const customBannerUrl = await getPanelBannerUrl(guild, configured);
    const references = new Map(guildConfig.session.panelMessages.map(reference => [reference.messageId, reference]));
    const configuredSessionChannelId = guildConfig.channels.sessions;
    if (configuredSessionChannelId) {
        const configuredChannel = await guild.channels.fetch(configuredSessionChannelId).catch(() => null);
        if (configuredChannel?.isTextBased() && 'messages' in configuredChannel) {
            const recentMessages = await configuredChannel.messages.fetch({ limit: 100 }).catch(() => null);
            for (const message of recentMessages?.values() || []) {
                if (message.author.id !== guild.client.user?.id) continue;
                const isSessionPanel = message.components.some(component =>
                    JSON.stringify(component.toJSON()).includes('session:status'));
                if (isSessionPanel) references.set(message.id, { channelId: message.channelId, messageId: message.id });
            }
        }
    }
    const candidates = [...references.values()].slice(-10);
    const retained = (await Promise.all(candidates.map(async reference => {
        const channel = await guild.channels.fetch(reference.channelId).catch(() => null);
        if (!channel?.isTextBased() || !('messages' in channel)) return null;
        const message = await channel.messages.fetch(reference.messageId).catch(() => null);
        if (!message) return null;
        const edited = await message.edit({
            components: [sessionPanel(status, configured, customBannerUrl)],
            attachments: [],
            files: customBannerUrl ? [bannerAttachment('underbanner')] : bannerFiles('session'),
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
        return edited ? reference : null;
    }))).filter((reference): reference is { channelId: string; messageId: string } => Boolean(reference));
    if (retained.length !== guildConfig.session.panelMessages.length
        || retained.some((reference, index) => reference.messageId !== guildConfig.session.panelMessages[index]?.messageId)) {
        await replaceSessionPanelReferences(guild, retained);
    }
    return retained.length;
}

function sessionAnnouncement(action: SessionLifecycleStatus, userId: string): ContainerBuilder {
    const copy: Record<SessionLifecycleStatus, { title: string; description: string }> = {
        online: { title: '✅ Session Started', description: 'The California State Roleplay session is now **online**. Use Quick Join below to enter the server.' },
        offline: { title: '🛑 Session Ended', description: 'The California State Roleplay session is now **offline**. Thank you to everyone who participated.' },
        voting: { title: '🗳️ Session Vote Open', description: 'A session vote is now open. If you support the session, be ready to join when it begins.' },
        boosted: { title: '🚀 Session Boost', description: 'The current California State Roleplay session has been **boosted** and needs more players. Join us now!' },
    };
    const container = new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${copy[action].title}`,
            copy[action].description,
            '',
            `**Updated by:** <@${userId}>`,
            `**Updated:** <t:${Math.floor(Date.now() / 1_000)}:R>`,
        ].join('\n')));
    if (action === 'online' || action === 'boosted') {
        container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel('Quick Join').setStyle(ButtonStyle.Link).setURL(QUICK_JOIN_URL).setEmoji('🎮'),
        ));
    }
    return container;
}

async function runSessionAction(interaction: ChatInputCommandInteraction, action: SessionLifecycleStatus): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await setSessionState(interaction.guild, action, interaction.user.id);
    const updatedPanels = await refreshSavedSessionPanels(interaction.guild);
    const channelId = await configuredChannelId(interaction.guild, 'sessions');
    const configuredChannel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
    const destination = configuredChannel?.isSendable() ? configuredChannel : interaction.channel?.isSendable() ? interaction.channel : null;
    if (destination) {
        await destination.send({
            components: [sessionAnnouncement(action, interaction.user.id)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    }
    void updatedPanels;
    await interaction.deleteReply().catch(() => undefined);
}

function regulationsPanel(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = parseEmojiMap(config.emojiText);
    const title = config.title === 'Community Regulations' ? DEFAULT_PANEL_CONFIGS.regulations.title : config.title;
    const description = config.description.startsWith('Our regulations keep every CSRP experience')
        ? DEFAULT_PANEL_CONFIGS.regulations.description
        : config.description;
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || REGULATIONS_BANNER_URL))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${safeEmoji(emojis.title, REGULATIONS_TITLE_EMOJI)} ${title}`,
            description,
            '',
            regulationsContent(config),
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(gallery(PANEL_UNDERBANNER_URL));
}

function regulationsContent(config: PanelConfig): string {
    const configured = config.questions?.trim();
    if (!configured) return `${DISCORD_RULES}\n\n${GAME_RULES}`;
    if (configured.includes('Swearing may not be directed at another person')) {
        return DEFAULT_PANEL_CONFIGS.regulations.questions || `${DISCORD_RULES}\n\n${GAME_RULES}`;
    }
    if (!configured.includes('---GAME---')) return configured;
    const [discord, game] = configured.split('---GAME---');
    return `${discord.trim()}\n\n${game.trim()}`;
}

function privateRulesPanel(config: PanelConfig): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(REGULATIONS_BANNER_URL))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(regulationsContent(config)))
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(gallery(PANEL_UNDERBANNER_URL));
}

function channelByName(guild: Guild, terms: string[]): string {
    const match = guild.channels.cache.find(channel => terms.some(term => channel.name.toLowerCase().includes(term)));
    return match ? `<#${match.id}>` : `#${terms[0]}`;
}

async function dashboardInformationPanel(guild: Guild): Promise<ContainerBuilder> {
    const [regulationsId, assistanceId, applicationsId] = await Promise.all([
        configuredChannelId(guild, 'regulations', CHANNEL_IDS.rules),
        configuredChannelId(guild, 'ticket_panel', CHANNEL_IDS.ticketPanel),
        configuredChannelId(guild, 'application_panel'),
    ]);
    const mention = (id: string, fallback: string[]): string => id ? `<#${id}>` : channelByName(guild, fallback);
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(INFORMATION_BANNER_URL))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Information',
            `Thank you for being part of **California State Roleplay**. The server was created by <@${guild.ownerId}> on <t:${Math.floor(guild.createdTimestamp / 1_000)}:D> to provide a realistic and enjoyable roleplay community. If anything in the server concerns you, you can always open a ticket in ${mention(assistanceId, ['support', 'assistance', 'ticket'])}.`,
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Important Channels',
            `${mention(regulationsId, ['regulations', 'rules'])} — Discord and in-game regulations.`,
            `${mention(assistanceId, ['support', 'assistance', 'ticket'])} — Open a private ticket when you need help.`,
            `${channelByName(guild, ['marketplace', 'market'])} — Browse items and services available from the server.`,
            `${channelByName(guild, ['departments', 'department'])} — View California’s whitelisted departments.`,
            `${channelByName(guild, ['verification', 'verify'])} — Verify your account and gain server access.`,
            `${mention(applicationsId, ['applications', 'apply'])} — Apply to join the California State Roleplay Staff Team.`,
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(gallery(PANEL_UNDERBANNER_URL));
}

async function dashboardPanel(guild: Guild, config: PanelConfig, customBannerUrl?: string | null): Promise<ContainerBuilder> {
    const emojis = parseEmojiMap(config.emojiText);
    const legacyDescription = 'Welcome to the central information hub for **California State Roleplay**. Review important server details and use the navigation below to reach the resources you need.';
    const description = config.description === legacyDescription
        ? '> 👋 Hello! Welcome to **California State Roleplay**, a community built to provide the most realistic roleplay experience possible. Our goal is to make sure you enjoy the server and receive professional support from our Staff Team. If you ever have a concern about a staff member, please open a ticket in the assistance channel and explain what happened. Use the menu below to find important server information and regulations. Thank you for being part of the California State Roleplay family—we hope you enjoy your time here!'
        : config.description;
    const menu = new StringSelectMenuBuilder()
        .setCustomId(DASHBOARD_MENU_ID)
        .setPlaceholder('Select a server resource')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Information')
                .setValue('information')
                .setDescription('Information about our server')
                .setEmoji(parseEmoji(safeEmoji(emojis.information, '<:Info:1546624828654620672>')) || { id: '1546624828654620672', name: 'Info' }),
            new StringSelectMenuOptionBuilder()
                .setLabel('Regulations')
                .setValue('regulations')
                .setDescription("Our server's rules")
                .setEmoji(parseEmoji(safeEmoji(emojis.rules, '<:game_rules:1516784266556604528>')) || { id: '1516784266556604528', name: 'game_rules' }),
        );
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || DASHBOARD_BANNER_URL))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
        .addMediaGalleryComponents(gallery(PANEL_UNDERBANNER_URL));
}

const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the CSRP server dashboard'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;
        const config = await getPanelConfig(guild, 'dashboard');
        const customBannerUrl = await getPanelBannerUrl(guild, config);
        const container = await dashboardPanel(guild, config, customBannerUrl);
        const payload = {
            components: [container],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const targetId = await configuredChannelId(guild, 'dashboard');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        const destination = target?.isSendable() ? target : interaction.channel?.isSendable() ? interaction.channel : null;
        if (!destination) { await interaction.editReply('I could not find a channel for the dashboard.'); return; }
        await destination.send(payload);
        await interaction.deleteReply().catch(() => undefined);
    },
};

const regulationsCommand = {
    data: new SlashCommandBuilder()
        .setName('regulations')
        .setDescription('Post the community regulations'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const config = await getPanelConfig(interaction.guild, 'regulations');
        const customBannerUrl = await getPanelBannerUrl(interaction.guild, config);
        const payload = {
            components: [regulationsPanel(config, customBannerUrl)],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const targetId = await configuredChannelId(interaction.guild, 'regulations');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        const destination = target?.isSendable() ? target : interaction.channel?.isSendable() ? interaction.channel : null;
        if (!destination) { await interaction.editReply('I could not find a channel for regulations.'); return; }
        await destination.send(payload);
        await interaction.deleteReply().catch(() => undefined);
    },
};

function applicationPanel(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = parseEmojiMap(config.emojiText);
    const apply = addButtonEmoji(
        new ButtonBuilder().setCustomId('application:open').setLabel('Begin Application').setStyle(ButtonStyle.Success),
        emojis.apply,
        '📝',
    );
    const status = addButtonEmoji(
        new ButtonBuilder().setCustomId('application:status').setLabel('Applications Open').setStyle(ButtonStyle.Secondary).setDisabled(true),
        emojis.status,
        '🟢',
    );
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('applications')))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${safeEmoji(emojis.title, '📋')} ${config.title}`,
            config.description,
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Before You Apply',
            '• Answer every question honestly and with enough detail for the review team.',
            '• Submit one application at a time and wait patiently for a decision.',
            '• Low-effort, copied, or misleading responses may be denied.',
            '',
            '> Your application is sent to a private staff review area.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(status, apply))
        .addTextDisplayComponents(panelFooter('Staff Recruitment'))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

const applicationPanelCommand = {
    data: new SlashCommandBuilder().setName('application-panel').setDescription('Post the staff application panel'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const config = await getPanelConfig(interaction.guild, 'application');
        const customBannerUrl = await getPanelBannerUrl(interaction.guild, config);
        const payload = {
            components: [applicationPanel(config, customBannerUrl)],
            files: [bannerAttachment('applications'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const targetId = await configuredChannelId(interaction.guild, 'application_panel');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        const destination = target?.isSendable() ? target : interaction.channel?.isSendable() ? interaction.channel : null;
        if (!destination) { await interaction.editReply('I could not find a channel for applications.'); return; }
        await destination.send(payload);
        await interaction.deleteReply().catch(() => undefined);
    },
};

export async function handlePanelButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'application:open') {
        const config = await getPanelConfig(interaction.guild, 'application');
        const questions = (config.questions || '').split(/\r?\n/).map(question => question.trim()).filter(Boolean).slice(0, 5);
        const modal = new ModalBuilder().setCustomId('application:submit').setTitle('CSRP Staff Application');
        for (const [index, question] of questions.entries()) {
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(`q${index}`).setLabel(question.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
            ));
        }
        await interaction.showModal(modal);
        return true;
    }
    const match = /^application:review:(accept|deny):(\d{17,20})$/.exec(interaction.customId);
    if (!match || !interaction.guild) return false;
    const [, decision, applicantId] = match;
    const saved = await getGuildBotConfig(interaction.guild);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const allowedRoleIds = [saved.roles.application_reviewer, saved.roles.staff, saved.roles.bot_permissions, TICKET_STAFF_ROLE_ID]
        .filter((roleId): roleId is string => Boolean(roleId));
    const authorized = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || allowedRoleIds.some(roleId => member?.roles.cache.has(roleId));
    if (!authorized) {
        await interaction.reply({ content: 'You are not authorized to review applications.', flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.deferUpdate();
    const accepted = decision === 'accept';
    const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);
    const dmDelivered = applicant ? await applicant.send({
        components: [new ContainerBuilder().setAccentColor(BRAND.color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# Application ${accepted ? 'Accepted' : 'Denied'}`,
                accepted
                    ? 'Your California State Roleplay staff application has been **accepted**. Staff will contact you with the next steps.'
                    : 'Your California State Roleplay staff application has been **denied**. You may contact staff if you have questions about reapplying.',
                '', `**Reviewed by:** ${interaction.user.tag}`,
            ].join('\n')))],
        flags: MessageFlags.IsComponentsV2,
    }).then(() => true).catch(() => false) : false;
    const rawComponents = interaction.message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    for (const component of rawComponents) {
        const children = component.components as Array<Record<string, unknown>> | undefined;
        for (const child of children || []) {
            if (child.type !== 1) continue;
            for (const button of (child.components as Array<Record<string, unknown>> | undefined) || []) button.disabled = true;
        }
    }
    await interaction.message.edit({ components: rawComponents as never, flags: MessageFlags.IsComponentsV2 });
    if (interaction.channel?.isSendable()) {
        await interaction.channel.send({
            components: [new ContainerBuilder().setAccentColor(BRAND.color)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# Application ${accepted ? 'Accepted' : 'Denied'}\n<@${applicantId}> was **${accepted ? 'accepted' : 'denied'}** by <@${interaction.user.id}>. ${dmDelivered ? 'The applicant was notified by DM.' : 'The applicant’s DMs are closed, so the DM could not be delivered.'}`,
                ))],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    }
    return true;
}

export async function handlePanelModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId !== 'application:submit') return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await getPanelConfig(interaction.guild, 'application');
    const emojis = parseEmojiMap(config.emojiText);
    const questions = (config.questions || '').split(/\r?\n/).map(question => question.trim()).filter(Boolean).slice(0, 5);
    const answers = questions.map((question, index) => `**${index + 1}. ${question}**\n${interaction.fields.getTextInputValue(`q${index}`)}`);
    const destination = await interaction.client.channels.fetch(await configuredChannelId(interaction.guild, 'application_reviews', process.env.APPLICATION_CHANNEL_ID || '')).catch(() => null);
    if (!destination?.isSendable()) {
        await interaction.editReply('The application review channel is not configured. An administrator can set it in `/config`.');
        return true;
    }
    if (!interaction.guild) return true;
    const saved = await getGuildBotConfig(interaction.guild);
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    const reviewerRoleIds = [...new Set([
        saved.roles.application_reviewer,
        saved.roles.staff,
        saved.roles.bot_permissions,
        TICKET_STAFF_ROLE_ID,
    ].filter((roleId): roleId is string => Boolean(roleId)))];
    const reviewChannel = await interaction.guild.channels.create({
        name: `application-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
        type: ChannelType.GuildText,
        parent: 'parentId' in destination && destination.parentId ? destination.parentId : undefined,
        topic: `CSRP application | Applicant ${interaction.user.id} | Applicant removed from staff review access`,
        permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
            ...reviewerRoleIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
        ],
        reason: `Staff application submitted by ${interaction.user.tag}`,
    }).catch(() => null);
    const reviewDestination = reviewChannel?.isSendable() ? reviewChannel : destination;
    await reviewDestination.send({
        components: [new ContainerBuilder().setAccentColor(BRAND.color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# ${emojis.title || '📋'} Staff Application • ${interaction.user.tag}`,
                `**Applicant:** <@${interaction.user.id}>`,
                `**Submitted:** <t:${Math.floor(Date.now() / 1000)}:f>`,
                '', ...answers,
            ].join('\n')))
            .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`application:review:accept:${interaction.user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`application:review:deny:${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
            ))],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    await interaction.editReply('Your application was submitted successfully. You have been removed from the private staff review ticket and will receive the decision by DM.');
    return true;
}

const sessionPanelCommand = {
    data: new SlashCommandBuilder()
        .setName('session-panel')
        .setDescription('Post the live roleplay session panel'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const guild = interaction.guild;
        const targetId = await configuredChannelId(guild, 'sessions');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        const externalTarget = target?.isSendable() && target.id !== interaction.channelId ? target : null;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const configured = await getPanelConfig(guild, 'session');
        const customBannerUrl = await getPanelBannerUrl(guild, configured);
        const session = await currentSessionDisplay(guild);

        const payload = {
            components: [sessionPanel(session, configured, customBannerUrl)],
            files: [bannerAttachment('session'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const destination = externalTarget || (interaction.channel?.isSendable() ? interaction.channel : null);
        if (!destination) { await interaction.editReply('I could not find a channel for the session panel.'); return; }
        const sent = await destination.send(payload);
        await registerSessionPanel(guild, sent.channelId, sent.id);
        await interaction.deleteReply().catch(() => undefined);
    },
};

function sessionActionCommand(name: 'session-start' | 'session-end' | 'session-vote' | 'session-boost', description: string, action: SessionLifecycleStatus) {
    return {
        data: new SlashCommandBuilder().setName(name).setDescription(description),
        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await runSessionAction(interaction, action);
        },
    };
}

const sessionStartCommand = sessionActionCommand('session-start', 'Start the roleplay session and mark every session panel online', 'online');
const sessionEndCommand = sessionActionCommand('session-end', 'End the roleplay session and mark every session panel offline', 'offline');
const sessionVoteCommand = sessionActionCommand('session-vote', 'Open a session vote and update every session panel', 'voting');
const sessionBoostCommand = sessionActionCommand('session-boost', 'Boost the active session and update every session panel', 'boosted');

export async function handlePanelSelectMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId === DASHBOARD_MENU_ID) {
        if (!interaction.guild) return false;
        const config = await getPanelConfig(interaction.guild, 'regulations');
        const container = interaction.values[0] === 'regulations'
            ? privateRulesPanel(config)
            : await dashboardInformationPanel(interaction.guild);
        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (interaction.customId !== REGULATIONS_MENU_ID) return false;
    const config = await getPanelConfig(interaction.guild, 'regulations');
    const [configuredDiscord, configuredGame] = (config.questions || '').split('---GAME---');
    const content = interaction.values[0] === 'game' ? (configuredGame?.trim() || GAME_RULES) : (configuredDiscord?.trim() || DISCORD_RULES);
    await interaction.reply({
        components: [privateRulesPanel({ ...config, questions: content })],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
    return true;
}

export const panelCommands = [
    dashboardCommand,
    regulationsCommand,
    sessionPanelCommand,
    sessionStartCommand,
    sessionEndCommand,
    sessionVoteCommand,
    sessionBoostCommand,
    applicationPanelCommand,
];

export async function runSessionActionFromMessage(message: Message, action: SessionLifecycleStatus): Promise<void> {
    if (!message.guild || !message.channel.isSendable()) return;
    await setSessionState(message.guild, action, message.author.id);
    const updatedPanels = await refreshSavedSessionPanels(message.guild);
    const destinationId = await configuredChannelId(message.guild, 'sessions');
    const configuredDestination = destinationId ? await message.client.channels.fetch(destinationId).catch(() => null) : null;
    const destination = configuredDestination?.isSendable() ? configuredDestination : message.channel;
    await destination.send({
        components: [sessionAnnouncement(action, message.author.id)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    if (destination.id !== message.channel.id) {
        await message.reply(`Session status updated. Refreshed ${updatedPanels} saved panel${updatedPanels === 1 ? '' : 's'}.`);
    }
}

export async function postPanelFromMessage(message: Message, panel: 'dashboard' | 'regulations' | 'session' | 'application' | 'staff_guide'): Promise<void> {
    if (!message.guild || !message.channel.isSendable()) return;
    const destinationKey = panel === 'dashboard' ? 'dashboard' : panel === 'regulations' ? 'regulations' : panel === 'session' ? 'sessions' : panel === 'staff_guide' ? 'staff_guide' : 'application_panel';
    const destinationId = await configuredChannelId(message.guild, destinationKey);
    const configuredDestination = destinationId ? await message.client.channels.fetch(destinationId).catch(() => null) : null;
    const destination = configuredDestination?.isSendable() ? configuredDestination : message.channel;
    if (panel === 'dashboard') {
        const config = await getPanelConfig(message.guild, 'dashboard');
        const customBannerUrl = await getPanelBannerUrl(message.guild, config);
        const container = await dashboardPanel(message.guild, config, customBannerUrl);
        await destination.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    if (panel === 'regulations') {
        const config = await getPanelConfig(message.guild, 'regulations');
        await destination.send({ components: [regulationsPanel(config, await getPanelBannerUrl(message.guild, config))], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    if (panel === 'application') {
        const config = await getPanelConfig(message.guild, 'application');
        await destination.send({ components: [applicationPanel(config, await getPanelBannerUrl(message.guild, config))], files: [bannerAttachment('applications'), bannerAttachment('underbanner')], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    if (panel === 'staff_guide') {
        const config = await getPanelConfig(message.guild, 'staff_guide');
        const customBanner = await getPanelBannerUrl(message.guild, config);
        await destination.send({
            components: [staffGuidePanel(config, customBanner)],
            files: customBanner ? [bannerAttachment('underbanner')] : bannerFiles('staffGuide'),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        return;
    }
    const config = await getPanelConfig(message.guild, 'session');
    const status = await currentSessionDisplay(message.guild);
    const sent = await destination.send({ components: [sessionPanel(status, config, await getPanelBannerUrl(message.guild, config))], files: [bannerAttachment('session'), bannerAttachment('underbanner')], flags: MessageFlags.IsComponentsV2 });
    await registerSessionPanel(message.guild, sent.channelId, sent.id);
}

/** Refreshes previously posted configurable panels so bundled banner updates go live after a restart. */
export async function refreshExistingPanelBanners(client: Client): Promise<number> {
    let refreshed = 0;
    const panels = [
        { panel: 'dashboard' as const, channel: 'dashboard', marker: DASHBOARD_MENU_ID, banner: 'dashboard' as const },
        { panel: 'regulations' as const, channel: 'regulations', marker: 'Discord Regulations', banner: 'regulations' as const },
        { panel: 'application' as const, channel: 'application_panel', marker: 'application:open', banner: 'applications' as const },
        { panel: 'staff_guide' as const, channel: 'staff_guide', marker: STAFF_GUIDE_URL, banner: 'staffGuide' as const },
    ] as const;

    for (const guild of client.guilds.cache.values()) {
        refreshed += await refreshSavedSessionPanels(guild).catch(() => 0);
        for (const definition of panels) {
            const channelId = await configuredChannelId(guild, definition.channel);
            if (!channelId) continue;
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased() || !('messages' in channel)) continue;
            const config = await getPanelConfig(guild, definition.panel);
            const customBannerUrl = await getPanelBannerUrl(guild, config);
            const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
            for (const message of messages?.values() || []) {
                if (message.author.id !== client.user?.id) continue;
                const serialized = message.components.map(component => component.toJSON());
                const componentText = JSON.stringify(serialized);
                const legacyMatch = definition.panel === 'dashboard'
                    ? componentText.includes('**Members:**')
                    : definition.panel === 'regulations' ? componentText.includes(REGULATIONS_MENU_ID) : false;
                if (!componentText.includes(definition.marker) && !legacyMatch) continue;
                let container: ContainerBuilder;
                if (definition.panel === 'dashboard') container = await dashboardPanel(guild, config, customBannerUrl);
                else if (definition.panel === 'regulations') container = regulationsPanel(config, customBannerUrl);
                else if (definition.panel === 'staff_guide') container = staffGuidePanel(config, customBannerUrl);
                else container = applicationPanel(config, customBannerUrl);
                const files = definition.panel === 'dashboard' || definition.panel === 'regulations'
                    ? []
                    : customBannerUrl ? [bannerAttachment('underbanner')] : bannerFiles(definition.banner);
                const edited = await message.edit({
                    components: [container],
                    attachments: [],
                    files,
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => null);
                if (edited) refreshed += 1;
            }
        }
    }
    return refreshed;
}

export interface PostAllPanelsResult {
    updated: string[];
    posted: string[];
    unavailable: string[];
}

/** Bring the configured core panels up to date; create any that cannot be found. */
export async function postAllPanels(guild: Guild): Promise<PostAllPanelsResult> {
    const result: PostAllPanelsResult = { updated: [], posted: [], unavailable: [] };
    const ticketResult = await postOrUpdateTicketPanel(guild);
    if (ticketResult === 'missing-channel') result.unavailable.push('Assistance');
    else if (ticketResult === 'updated') result.updated.push('Assistance');
    else result.posted.push('Assistance');

    const definitions = [
        { panel: 'dashboard' as const, channel: 'dashboard', marker: DASHBOARD_MENU_ID, label: 'Dashboard', banner: 'dashboard' as const },
        { panel: 'regulations' as const, channel: 'regulations', marker: 'Discord Regulations', label: 'Regulations', banner: 'regulations' as const },
        { panel: 'application' as const, channel: 'application_panel', marker: 'application:open', label: 'Applications', banner: 'applications' as const },
        { panel: 'staff_guide' as const, channel: 'staff_guide', marker: STAFF_GUIDE_URL, label: 'Staff Guide', banner: 'staffGuide' as const },
    ] as const;

    for (const definition of definitions) {
        const channelId = await configuredChannelId(guild, definition.channel);
        const destination = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (!destination?.isSendable() || !('messages' in destination)) {
            result.unavailable.push(definition.label);
            continue;
        }
        const config = await getPanelConfig(guild, definition.panel);
        const customBannerUrl = await getPanelBannerUrl(guild, config);
        const recentMessages = await destination.messages.fetch({ limit: 100 }).catch(() => null);
        const existingPanels = recentMessages?.filter(message => {
            if (message.author.id !== guild.client.user?.id) return false;
            const componentText = JSON.stringify(message.components.map(component => component.toJSON()));
            const legacyMatch = definition.panel === 'dashboard'
                ? componentText.includes('**Members:**')
                : definition.panel === 'regulations' ? componentText.includes(REGULATIONS_MENU_ID) : false;
            return componentText.includes(definition.marker) || legacyMatch;
        });

        let container: ContainerBuilder;
        if (definition.panel === 'dashboard') {
            container = await dashboardPanel(guild, config, customBannerUrl);
        } else if (definition.panel === 'regulations') {
            container = regulationsPanel(config, customBannerUrl);
        } else if (definition.panel === 'staff_guide') {
            container = staffGuidePanel(config, customBannerUrl);
        } else {
            container = applicationPanel(config, customBannerUrl);
        }
        const files = definition.panel === 'dashboard' || definition.panel === 'regulations'
            ? []
            : customBannerUrl ? [bannerAttachment('underbanner')] : bannerFiles(definition.banner);
        if (existingPanels?.size) {
            for (const existing of existingPanels.values()) {
                await existing.edit({ components: [container], attachments: [], files, flags: MessageFlags.IsComponentsV2 });
            }
            result.updated.push(definition.label);
        } else {
            await destination.send({ components: [container], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
            result.posted.push(definition.label);
        }
    }

    const configured = await getPanelConfig(guild, 'session');
    const customBannerUrl = await getPanelBannerUrl(guild, configured);
    const sessionChannelId = await configuredChannelId(guild, 'sessions');
    const sessionChannel = sessionChannelId ? await guild.channels.fetch(sessionChannelId).catch(() => null) : null;
    if (!sessionChannel?.isSendable() || !('messages' in sessionChannel)) {
        result.unavailable.push('Sessions');
    } else {
        const updatedCount = await refreshSavedSessionPanels(guild);
        const recentMessages = await sessionChannel.messages.fetch({ limit: 100 }).catch(() => null);
        const existing = recentMessages?.find(message => message.author.id === guild.client.user?.id
            && JSON.stringify(message.components.map(component => component.toJSON())).includes('session:status'));
        if (existing || updatedCount > 0) {
            result.updated.push('Sessions');
        } else {
            const status = await currentSessionDisplay(guild);
            const sent = await sessionChannel.send({
                components: [sessionPanel(status, configured, customBannerUrl)],
                files: customBannerUrl ? [bannerAttachment('underbanner')] : bannerFiles('session'),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            await registerSessionPanel(guild, sent.channelId, sent.id);
            result.posted.push('Sessions');
        }
    }
    return result;
}
