import {
    ChannelType,
    Guild,
    PermissionFlagsBits,
    TextChannel,
    type Attachment,
} from 'discord.js';
import { logger } from '../utils/logger';

export type ConfigurablePanel = 'ticket' | 'ticket_panel' | 'dashboard' | 'regulations' | 'application' | 'infraction' | 'promotion' | 'session' | 'welcome';

export interface PanelConfig {
    title: string;
    description: string;
    bannerMessageId?: string;
    emojiText?: string;
    questions?: string;
}

const STORE_CHANNEL_NAME = 'bot-config';
const RECORD_PREFIX = 'LARP_PANEL_CONFIG:';
const GUILD_CONFIG_PREFIX = 'CSRP_GUILD_CONFIG\n';
const cache = new Map<string, PanelConfig>();
const guildConfigCache = new Map<string, GuildBotConfig>();

export const CONFIG_CHANNEL_KEYS = [
    'ticket_panel', 'ticket_transcripts', 'regulations', 'dashboard', 'sessions', 'application_panel', 'application_reviews',
    'infractions', 'promotions', 'command_logs', 'welcome', 'general_ticket_category', 'internal_ticket_category',
    'management_ticket_category', 'highrank_ticket_category',
] as const;
export type ConfigChannelKey = typeof CONFIG_CHANNEL_KEYS[number];

export const CONFIG_ROLE_KEYS = [
    'bot_permissions', 'staff', 'general_support', 'internal_affairs', 'management', 'high_rank',
    'application_reviewer', 'session_host', 'on_duty', 'on_break',
    'infraction_warning', 'infraction_strike', 'infraction_suspension', 'infraction_demotion',
    'infraction_termination', 'infraction_blacklist',
] as const;
export type ConfigRoleKey = typeof CONFIG_ROLE_KEYS[number];

export interface ManagedRoleConfig {
    roleId: string;
    name: string;
    purpose: string;
    permissions: string[];
}

export type SessionLifecycleStatus = 'offline' | 'voting' | 'online' | 'boosted';

export interface SessionPanelReference {
    channelId: string;
    messageId: string;
}

export interface SessionState {
    status: SessionLifecycleStatus;
    updatedAt: number;
    updatedBy: string;
    panelMessages: SessionPanelReference[];
}

export interface GuildBotConfig {
    channels: Partial<Record<ConfigChannelKey, string>>;
    roles: Partial<Record<ConfigRoleKey, string>>;
    managedRoles: ManagedRoleConfig[];
    session: SessionState;
}

export const DEFAULT_PANEL_CONFIGS: Record<ConfigurablePanel, PanelConfig> = {
    ticket: {
        title: 'Support Ticket Opened',
        description: '## <:ticketthanks:1525234122568765710> Thanks {opener} for contacting support!\n\nThank you for opening a ticket in **California State Roleplay**. {staff} will help you shortly. While you wait, please do not ping staff. Responses may take up to an hour. If you have not received an answer within **12 hours**, you may ping a staff member. If you are reporting someone, include the user’s **ID**, **screenshots**, and a clear explanation below.\n\n**Ticket Information**\n› **Opener:** {opener}\n› **Ticket ID:** `{ticket_id}`\n› **Inquiry:** {inquiry}',
        emojiText: 'title=<:support:1525234150045519982>\nclaim=🙋\nclose=🔒\nescalate=🚨',
    },
    ticket_panel: {
        title: 'Assistance',
        description: 'Choose the department that best fits your request. Add the details staff need to review it, and they will follow up in your private ticket.',
        emojiText: 'title=<:support:1525234150045519982>\ngeneral=<:general:1516784296340230194>\nmanagement=<:management:1553956417273340045>\nhighrank=<:highrank:1553956417273340045>',
    },
    dashboard: {
        title: 'California State Roleplay Dashboard',
        description: 'Quick links to California State Roleplay information, regulations, applications, and Assistance.',
        emojiText: 'title=📊\nrules=📜\nsupport=🎫\napplications=📋\nsession=🌐',
    },
    regulations: {
        title: 'Community Regulations',
        description: 'Select a category below to review the rules. Your selection will be shown privately.',
        emojiText: 'title=<:regulations:1516784266556604528>\ndiscord=💬\ngame=🎮',
        questions: '# Discord Rules\n\n1. Swearing may not be directed at another person, and slurs are never allowed.\n2. Treat staff and community members with respect.\n3. Advertising, self-promotion, and spam are prohibited.\n4. Use every channel for its intended purpose.\n5. Follow Discord Terms of Service.\n6. Staff may enforce serious unlisted violations when necessary.\n---GAME---\n# In-Game Rules\n\n1. If you vote for a session, you are expected to join.\n2. RDM, VDM, NLR, and similar roleplay violations will result in punishment.\n3. Do not disrespect staff while they are on duty.\n4. Proper and realistic roleplay is expected at all times.\n5. Follow Roblox Terms of Service.\n6. Staff may enforce serious unlisted violations when necessary.',
    },
    application: {
        title: 'Staff Applications',
        description: 'Interested in joining the California State Roleplay staff team? Press **Apply** below and answer every question carefully. Incomplete or dishonest applications may be denied.',
        emojiText: 'title=📋\napply=📝',
        questions: 'What is your Roblox username?\nHow old are you?\nWhy do you want to join the CSRP staff team?\nWhat experience do you have?\nHow would you handle a disruptive member?',
    },
    infraction: {
        title: 'Staff Infraction Issued',
        description: '> Hello **{member}**, a **{action}** has been placed on your staff record.\n\n› **Reason:** {reason}\n\n› **Infraction type:** {action}\n\n› **Issued by:** **{issuer}**\n\n› **Appeal status:** {appeal_status}',
        emojiText: 'title=⚠️',
    },
    promotion: {
        title: 'Staff Promotion',
        description: '*Authorized by **{promoter}***\n\n› **Promoted staff:** **{member}**\n\n› **Previous role:** {old_role}\n\n› **New role:** **{new_role}**\n\n› **Additional notes:** {notes}',
        emojiText: 'title=📈',
    },
    session: {
        title: 'Session Information',
        description: '> Check the player count, staff on duty, and queue here. When the session is open, use **Quick Join** to enter.\n\n**Last Updated:** {updated}',
        emojiText: 'title=<:session:1525234122568765710>\nstaff=👥\nplayers=👤\nonline=✅\noffline=📡\nvote=🗳️\nboost=🚀',
    },
    welcome: {
        title: 'Welcome to {server}!',
        description: 'Welcome {member}! We are glad to have you here. Please review the server information and make yourself at home.\n\nYou are member **#{member_count}**.',
        emojiText: 'title=👋\nmember=👤',
    },
};

function cacheKey(guildId: string, panel: ConfigurablePanel): string {
    return `${guildId}:${panel}`;
}

function cloneConfig(config: PanelConfig): PanelConfig {
    return { ...config };
}

async function findStoreChannel(guild: Guild): Promise<TextChannel | null> {
    await guild.channels.fetch().catch(() => null);
    return guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText && channel.name === STORE_CHANNEL_NAME,
    ) as TextChannel | undefined || null;
}

async function ensureStoreChannel(guild: Guild): Promise<TextChannel | null> {
    const existing = await findStoreChannel(guild);
    if (existing) return existing;
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
    return guild.channels.create({
        name: STORE_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: 'Private persistent configuration storage for the roleplay bot.',
        reason: 'Created automatically for /config persistence',
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
        ],
    }).catch(() => null);
}

function parseRecord(content: string, panel: ConfigurablePanel): PanelConfig | null {
    const prefix = `${RECORD_PREFIX}${panel}\n`;
    if (!content.startsWith(prefix)) return null;
    try {
        const parsed = JSON.parse(content.slice(prefix.length)) as Partial<PanelConfig>;
        if (typeof parsed.title !== 'string' || typeof parsed.description !== 'string') return null;
        return {
            title: parsed.title.slice(0, 256),
            description: parsed.description.slice(0, 1_400),
            bannerMessageId: typeof parsed.bannerMessageId === 'string' ? parsed.bannerMessageId : undefined,
            emojiText: typeof parsed.emojiText === 'string' ? parsed.emojiText.slice(0, 500) : DEFAULT_PANEL_CONFIGS[panel].emojiText,
            questions: typeof parsed.questions === 'string' ? parsed.questions.slice(0, 3_000) : DEFAULT_PANEL_CONFIGS[panel].questions,
        };
    } catch {
        return null;
    }
}

export async function getPanelConfig(guild: Guild | null, panel: ConfigurablePanel): Promise<PanelConfig> {
    if (!guild) return cloneConfig(DEFAULT_PANEL_CONFIGS[panel]);
    const key = cacheKey(guild.id, panel);
    const cached = cache.get(key);
    if (cached) return cloneConfig(cached);
    const channel = await findStoreChannel(guild);
    if (channel) {
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        const record = messages?.find(message => message.author.id === guild.client.user?.id && message.content.startsWith(`${RECORD_PREFIX}${panel}\n`));
        const parsed = record ? parseRecord(record.content, panel) : null;
        if (parsed) {
            cache.set(key, parsed);
            return cloneConfig(parsed);
        }
    }
    return cloneConfig(DEFAULT_PANEL_CONFIGS[panel]);
}

export async function getPanelBannerUrl(guild: Guild | null, config: PanelConfig): Promise<string | null> {
    if (!guild || !config.bannerMessageId) return null;
    const channel = await findStoreChannel(guild);
    if (!channel) return null;
    const message = await channel.messages.fetch(config.bannerMessageId).catch(() => null);
    return message?.attachments.first()?.url || null;
}

export async function savePanelConfig(
    guild: Guild,
    panel: ConfigurablePanel,
    config: PanelConfig,
    banner?: Attachment,
): Promise<{ config: PanelConfig; persistent: boolean }> {
    const normalized: PanelConfig = {
        title: config.title.trim().slice(0, 256) || DEFAULT_PANEL_CONFIGS[panel].title,
        description: config.description.trim().slice(0, 1_400) || DEFAULT_PANEL_CONFIGS[panel].description,
        bannerMessageId: config.bannerMessageId,
        emojiText: (config.emojiText || DEFAULT_PANEL_CONFIGS[panel].emojiText)?.trim().slice(0, 500),
        questions: (config.questions || DEFAULT_PANEL_CONFIGS[panel].questions)?.trim().slice(0, 3_000),
    };
    const channel = await ensureStoreChannel(guild);
    if (!channel) {
        cache.set(cacheKey(guild.id, panel), normalized);
        logger.warn(`Could not create #${STORE_CHANNEL_NAME}; ${panel} configuration is stored for this runtime only.`);
        return { config: cloneConfig(normalized), persistent: false };
    }

    if (banner) {
        const bannerMessage = await channel.send({
            content: `LARP_PANEL_BANNER:${panel}`,
            files: [{ attachment: banner.url, name: banner.name || `${panel}-banner.png` }],
            allowedMentions: { parse: [] },
        });
        normalized.bannerMessageId = bannerMessage.id;
    }

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existing = messages?.find(message => message.author.id === guild.client.user?.id && message.content.startsWith(`${RECORD_PREFIX}${panel}\n`));
    const content = `${RECORD_PREFIX}${panel}\n${JSON.stringify(normalized)}`;
    if (existing) await existing.edit({ content, allowedMentions: { parse: [] } });
    else await channel.send({ content, allowedMentions: { parse: [] } });
    cache.set(cacheKey(guild.id, panel), normalized);
    return { config: cloneConfig(normalized), persistent: true };
}

export function applyTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}

export interface SessionEmojis {
    title: string;
    staff: string;
    players: string;
    queue: string;
    online: string;
    offline: string;
    vote: string;
    boost: string;
    join: string;
}

const DEFAULT_SESSION_EMOJIS: SessionEmojis = {
    title: '🌐', staff: '👥', players: '👤', queue: '🕒', online: '✅', offline: '📡', vote: '🗳️', boost: '🚀', join: '🎮',
};

export function parseSessionEmojis(value?: string): SessionEmojis {
    const parsed = { ...DEFAULT_SESSION_EMOJIS };
    for (const line of (value || '').split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim().toLowerCase() as keyof SessionEmojis;
        const emoji = line.slice(separator + 1).trim();
        if (key in parsed && emoji && emoji.length <= 100) parsed[key] = emoji;
    }
    return parsed;
}

export function parseEmojiMap(value?: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of (value || '').split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const emoji = line.slice(separator + 1).trim();
        if (/^[a-z0-9_]{1,32}$/.test(key) && emoji && emoji.length <= 100) result[key] = emoji;
    }
    return result;
}

function normalizeGuildConfig(value?: Partial<GuildBotConfig>): GuildBotConfig {
    const channels: GuildBotConfig['channels'] = {};
    const roles: GuildBotConfig['roles'] = {};
    for (const key of CONFIG_CHANNEL_KEYS) {
        const id = value?.channels?.[key];
        if (typeof id === 'string' && /^\d{17,20}$/.test(id)) channels[key] = id;
    }
    for (const key of CONFIG_ROLE_KEYS) {
        const id = value?.roles?.[key];
        if (typeof id === 'string' && /^\d{17,20}$/.test(id)) roles[key] = id;
    }
    const managedRoles = Array.isArray(value?.managedRoles) ? value.managedRoles.filter(role =>
        role && typeof role.roleId === 'string' && typeof role.name === 'string' && typeof role.purpose === 'string'
            && Array.isArray(role.permissions),
    ).slice(0, 50) : [];
    const validStatuses: SessionLifecycleStatus[] = ['offline', 'voting', 'online', 'boosted'];
    const status = validStatuses.includes(value?.session?.status as SessionLifecycleStatus)
        ? value!.session!.status
        : 'offline';
    const panelMessages = Array.isArray(value?.session?.panelMessages)
        ? value.session.panelMessages.filter(reference => reference
            && typeof reference.channelId === 'string' && /^\d{17,20}$/.test(reference.channelId)
            && typeof reference.messageId === 'string' && /^\d{17,20}$/.test(reference.messageId))
            .slice(-10)
        : [];
    const session: SessionState = {
        status,
        updatedAt: typeof value?.session?.updatedAt === 'number' ? value.session.updatedAt : 0,
        updatedBy: typeof value?.session?.updatedBy === 'string' ? value.session.updatedBy : '',
        panelMessages,
    };
    return { channels, roles, managedRoles, session };
}

export async function getGuildBotConfig(guild: Guild | null): Promise<GuildBotConfig> {
    if (!guild) return normalizeGuildConfig();
    const cached = guildConfigCache.get(guild.id);
    if (cached) return JSON.parse(JSON.stringify(cached)) as GuildBotConfig;
    const channel = await findStoreChannel(guild);
    if (channel) {
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        const record = messages?.find(message => message.author.id === guild.client.user?.id && message.content.startsWith(GUILD_CONFIG_PREFIX));
        if (record) {
            try {
                const parsed = normalizeGuildConfig(JSON.parse(record.content.slice(GUILD_CONFIG_PREFIX.length)) as Partial<GuildBotConfig>);
                guildConfigCache.set(guild.id, parsed);
                return JSON.parse(JSON.stringify(parsed)) as GuildBotConfig;
            } catch { /* use defaults */ }
        }
    }
    return normalizeGuildConfig();
}

export async function saveGuildBotConfig(guild: Guild, value: GuildBotConfig): Promise<boolean> {
    const normalized = normalizeGuildConfig(value);
    guildConfigCache.set(guild.id, normalized);
    const channel = await ensureStoreChannel(guild);
    if (!channel) return false;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existing = messages?.find(message => message.author.id === guild.client.user?.id && message.content.startsWith(GUILD_CONFIG_PREFIX));
    const content = `${GUILD_CONFIG_PREFIX}${JSON.stringify(normalized)}`;
    if (existing) await existing.edit({ content, allowedMentions: { parse: [] } });
    else await channel.send({ content, allowedMentions: { parse: [] } });
    return true;
}

export async function configuredChannelId(guild: Guild | null, key: ConfigChannelKey, fallback = ''): Promise<string> {
    return (await getGuildBotConfig(guild)).channels[key] || fallback;
}

export async function configuredRoleId(guild: Guild | null, key: ConfigRoleKey, fallback = ''): Promise<string> {
    return (await getGuildBotConfig(guild)).roles[key] || fallback;
}

export async function getSessionState(guild: Guild | null): Promise<SessionState> {
    return (await getGuildBotConfig(guild)).session;
}

export async function setSessionState(guild: Guild, status: SessionLifecycleStatus, updatedBy: string): Promise<SessionState> {
    const config = await getGuildBotConfig(guild);
    config.session.status = status;
    config.session.updatedAt = Date.now();
    config.session.updatedBy = updatedBy;
    await saveGuildBotConfig(guild, config);
    return config.session;
}

export async function registerSessionPanel(guild: Guild, channelId: string, messageId: string): Promise<void> {
    const config = await getGuildBotConfig(guild);
    config.session.panelMessages = [
        ...config.session.panelMessages.filter(reference => reference.messageId !== messageId),
        { channelId, messageId },
    ].slice(-10);
    await saveGuildBotConfig(guild, config);
}

export async function replaceSessionPanelReferences(guild: Guild, references: SessionPanelReference[]): Promise<void> {
    const config = await getGuildBotConfig(guild);
    config.session.panelMessages = references.slice(-10);
    await saveGuildBotConfig(guild, config);
}
