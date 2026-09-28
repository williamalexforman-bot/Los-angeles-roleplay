import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    Guild,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { bannerAttachment, bannerFiles, bannerUrl } from '../utils/bannerAssets';
import { fetchErlcServer } from '../services/erlcService';
import {
    applyTemplate,
    configuredChannelId,
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
const REGULATIONS_MENU_ID = 'regulations:menu';

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

function loadingSessionPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# 🌐 Session Information\n> Loading the latest session information…'),
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
        `# ${emojis.title} ${applyTemplate(configured.title, values)}`,
        applyTemplate(configured.description, values),
    ].join('\n'));

    const setEmoji = (button: ButtonBuilder, emoji: string): ButtonBuilder => {
        try { return button.setEmoji(emoji); } catch { return button; }
    };

    const counters = new ActionRowBuilder<ButtonBuilder>().addComponents(
        setEmoji(new ButtonBuilder()
            .setCustomId('session:staff-count')
            .setLabel(`Staff Online: ${status.staff}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.staff),
        setEmoji(new ButtonBuilder()
            .setCustomId('session:player-count')
            .setLabel(`Players In-Game: ${status.players}/${status.maximum}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.players),
        setEmoji(new ButtonBuilder()
            .setCustomId('session:queue-count')
            .setLabel(`In Queue: ${status.queue}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.queue),
    );

    const display = lifecycleDisplay(status.lifecycle);
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        setEmoji(new ButtonBuilder()
            .setCustomId('session:status')
            .setLabel(display.label)
            .setStyle(display.style)
            .setDisabled(true), emojis[display.emoji]),
        setEmoji(new ButtonBuilder()
            .setLabel('Quick Join')
            .setStyle(ButtonStyle.Link)
            .setURL(QUICK_JOIN_URL), emojis.join),
    );

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('dashboard')))
        .addTextDisplayComponents(information)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(counters, controls)
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

async function refreshSavedSessionPanels(guild: Guild): Promise<number> {
    const [guildConfig, configured, status] = await Promise.all([
        getGuildBotConfig(guild),
        getPanelConfig(guild, 'session'),
        currentSessionDisplay(guild),
    ]);
    const customBannerUrl = await getPanelBannerUrl(guild, configured);
    const retained = (await Promise.all(guildConfig.session.panelMessages.map(async reference => {
        const channel = await guild.channels.fetch(reference.channelId).catch(() => null);
        if (!channel?.isTextBased() || !('messages' in channel)) return null;
        const message = await channel.messages.fetch(reference.messageId).catch(() => null);
        if (!message) return null;
        const edited = await message.edit({
            components: [sessionPanel(status, configured, customBannerUrl)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
        return edited ? reference : null;
    }))).filter((reference): reference is { channelId: string; messageId: string } => Boolean(reference));
    if (retained.length !== guildConfig.session.panelMessages.length) {
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
    await interaction.editReply(`Session status changed to **${lifecycleDisplay(action).label.replace('Session ', '')}**. Updated ${updatedPanels} saved session panel${updatedPanels === 1 ? '' : 's'}.`);
}

function regulationsPanel(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = parseEmojiMap(config.emojiText);
    const menu = new StringSelectMenuBuilder()
        .setCustomId(REGULATIONS_MENU_ID)
        .setPlaceholder('Select a regulation category')
        .addOptions(
            {
                label: 'Discord Regulations',
                description: 'View the community and Discord rules',
                value: 'discord',
                emoji: emojis.discord || '💬',
            },
            {
                label: 'Game Regulations',
                description: 'View the in-game and roleplay rules',
                value: 'game',
                emoji: emojis.game || '🎮',
            },
        );

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('regulations')))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                `# ${emojis.title || '📜'} ${config.title}`,
                config.description,
            ].join('\n')),
        )
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

function privateRulesPanel(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function linkButton(label: string, guildId: string, channelId: string): ButtonBuilder | null {
    if (!channelId) return null;
    return new ButtonBuilder()
        .setLabel(label)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
}

const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the CSRP server dashboard'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }
        const guild = interaction.guild;
        const config = await getPanelConfig(guild, 'dashboard');
        const customBannerUrl = await getPanelBannerUrl(guild, config);
        const emojis = parseEmojiMap(config.emojiText);
        const values = { members: guild.memberCount.toLocaleString(), owner: `<@${guild.ownerId}>`, created: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` };
        const buttons = [
            linkButton('Regulations', guild.id, await configuredChannelId(guild, 'regulations', CHANNEL_IDS.rules)),
            linkButton('Support', guild.id, await configuredChannelId(guild, 'ticket_panel', CHANNEL_IDS.ticketPanel)),
        ].filter((button): button is ButtonBuilder => Boolean(button));
        if (buttons[0]) try { buttons[0].setEmoji(emojis.rules || '📜'); } catch { /* invalid custom emoji */ }
        if (buttons[1]) try { buttons[1].setEmoji(emojis.support || '🎫'); } catch { /* invalid custom emoji */ }
        const container = new ContainerBuilder().setAccentColor(BRAND.color)
            .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('dashboard')))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# ${emojis.title || '📊'} ${applyTemplate(config.title, values)}`,
                applyTemplate(config.description, values),
                '',
                `**Members:** ${values.members}`,
                `**Owner:** ${values.owner}`,
                `**Created:** ${values.created}`,
            ].join('\n')));
        if (buttons.length) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
        container.addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
        const payload = {
            components: [container],
            files: bannerFiles('dashboard'),
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const targetId = await configuredChannelId(guild, 'dashboard');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        if (target?.isSendable() && target.id !== interaction.channelId) {
            await target.send(payload);
            await interaction.reply({ content: `Dashboard posted in <#${target.id}>.`, flags: MessageFlags.Ephemeral });
        } else await interaction.reply(payload);
    },
};

const regulationsCommand = {
    data: new SlashCommandBuilder()
        .setName('regulations')
        .setDescription('Post the community regulations'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const config = await getPanelConfig(interaction.guild, 'regulations');
        const customBannerUrl = await getPanelBannerUrl(interaction.guild, config);
        const payload = {
            components: [regulationsPanel(config, customBannerUrl)],
            files: [bannerAttachment('regulations'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        const targetId = await configuredChannelId(interaction.guild, 'regulations');
        const target = targetId ? await interaction.client.channels.fetch(targetId).catch(() => null) : null;
        if (target?.isSendable() && target.id !== interaction.channelId) {
            await target.send(payload);
            await interaction.reply({ content: `Regulations posted in <#${target.id}>.`, flags: MessageFlags.Ephemeral });
        } else await interaction.reply(payload);
    },
};

function applicationPanel(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = parseEmojiMap(config.emojiText);
    const apply = new ButtonBuilder().setCustomId('application:open').setLabel('Apply').setStyle(ButtonStyle.Success);
    try { apply.setEmoji(emojis.apply || '📝'); } catch { /* invalid custom emoji */ }
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('applications')))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${emojis.title || '📋'} ${config.title}`,
            config.description,
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(apply))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

const applicationPanelCommand = {
    data: new SlashCommandBuilder().setName('application-panel').setDescription('Post the staff application panel'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
        if (target?.isSendable() && target.id !== interaction.channelId) {
            await target.send(payload);
            await interaction.reply({ content: `Application panel posted in <#${target.id}>.`, flags: MessageFlags.Ephemeral });
        } else await interaction.reply(payload);
    },
};

export async function handlePanelButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'application:open') return false;
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
    await destination.send({
        components: [new ContainerBuilder().setAccentColor(BRAND.color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# ${emojis.title || '📋'} Staff Application • ${interaction.user.tag}`,
                `**Applicant:** <@${interaction.user.id}>`,
                `**Submitted:** <t:${Math.floor(Date.now() / 1000)}:f>`,
                '', ...answers,
            ].join('\n')))],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    await interaction.editReply('Your application was submitted successfully.');
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
        await interaction.reply({
            ...(externalTarget ? { content: 'Loading the live session panel…' } : { components: [loadingSessionPanel()] }),
            flags: externalTarget ? MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });

        const configured = await getPanelConfig(guild, 'session');
        const customBannerUrl = await getPanelBannerUrl(guild, configured);
        const session = await currentSessionDisplay(guild);

        const payload = {
            components: [sessionPanel(session, configured, customBannerUrl)],
            files: [bannerAttachment('dashboard'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] as never[] },
        };
        if (externalTarget) {
            const sent = await externalTarget.send(payload);
            await registerSessionPanel(guild, sent.channelId, sent.id);
            await interaction.editReply(`Session panel posted in <#${externalTarget.id}>.`);
        } else {
            const sent = await interaction.editReply(payload);
            await registerSessionPanel(guild, sent.channelId, sent.id);
        }
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
    if (interaction.customId !== REGULATIONS_MENU_ID) return false;
    const config = await getPanelConfig(interaction.guild, 'regulations');
    const [configuredDiscord, configuredGame] = (config.questions || '').split('---GAME---');
    const content = interaction.values[0] === 'game' ? (configuredGame?.trim() || GAME_RULES) : (configuredDiscord?.trim() || DISCORD_RULES);
    await interaction.reply({
        components: [privateRulesPanel(content)],
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

export async function postPanelFromMessage(message: Message, panel: 'dashboard' | 'regulations' | 'session' | 'application'): Promise<void> {
    if (!message.guild || !message.channel.isSendable()) return;
    const destinationKey = panel === 'dashboard' ? 'dashboard' : panel === 'regulations' ? 'regulations' : panel === 'session' ? 'sessions' : 'application_panel';
    const destinationId = await configuredChannelId(message.guild, destinationKey);
    const configuredDestination = destinationId ? await message.client.channels.fetch(destinationId).catch(() => null) : null;
    const destination = configuredDestination?.isSendable() ? configuredDestination : message.channel;
    if (panel === 'dashboard') {
        const config = await getPanelConfig(message.guild, 'dashboard');
        const customBannerUrl = await getPanelBannerUrl(message.guild, config);
        const emojis = parseEmojiMap(config.emojiText);
        const values = { members: message.guild.memberCount.toLocaleString(), owner: `<@${message.guild.ownerId}>`, created: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:D>` };
        const container = new ContainerBuilder().setAccentColor(BRAND.color)
            .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('dashboard')))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# ${emojis.title || '📊'} ${applyTemplate(config.title, values)}`, applyTemplate(config.description, values), '',
                `**Members:** ${values.members}`, `**Owner:** ${values.owner}`, `**Created:** ${values.created}`,
            ].join('\n')));
        const buttons = [
            linkButton('Regulations', message.guild.id, await configuredChannelId(message.guild, 'regulations', CHANNEL_IDS.rules)),
            linkButton('Support', message.guild.id, await configuredChannelId(message.guild, 'ticket_panel', CHANNEL_IDS.ticketPanel)),
        ].filter((button): button is ButtonBuilder => Boolean(button));
        if (buttons[0]) try { buttons[0].setEmoji(emojis.rules || '📜'); } catch { /* invalid custom emoji */ }
        if (buttons[1]) try { buttons[1].setEmoji(emojis.support || '🎫'); } catch { /* invalid custom emoji */ }
        if (buttons.length) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
        container.addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
        await destination.send({ components: [container], files: bannerFiles('dashboard'), flags: MessageFlags.IsComponentsV2 });
        return;
    }
    if (panel === 'regulations') {
        const config = await getPanelConfig(message.guild, 'regulations');
        await destination.send({ components: [regulationsPanel(config, await getPanelBannerUrl(message.guild, config))], files: [bannerAttachment('regulations'), bannerAttachment('underbanner')], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    if (panel === 'application') {
        const config = await getPanelConfig(message.guild, 'application');
        await destination.send({ components: [applicationPanel(config, await getPanelBannerUrl(message.guild, config))], files: [bannerAttachment('applications'), bannerAttachment('underbanner')], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    const config = await getPanelConfig(message.guild, 'session');
    const status = await currentSessionDisplay(message.guild);
    const sent = await destination.send({ components: [sessionPanel(status, config, await getPanelBannerUrl(message.guild, config))], files: [bannerAttachment('dashboard'), bannerAttachment('underbanner')], flags: MessageFlags.IsComponentsV2 });
    await registerSessionPanel(message.guild, sent.channelId, sent.id);
}
