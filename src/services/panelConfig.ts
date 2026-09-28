import {
    ChannelType,
    Guild,
    PermissionFlagsBits,
    TextChannel,
    type Attachment,
} from 'discord.js';
import { logger } from '../utils/logger';

export type ConfigurablePanel = 'ticket' | 'infraction' | 'promotion';

export interface PanelConfig {
    title: string;
    description: string;
    bannerMessageId?: string;
}

const STORE_CHANNEL_NAME = 'bot-config';
const RECORD_PREFIX = 'LARP_PANEL_CONFIG:';
const cache = new Map<string, PanelConfig>();

export const DEFAULT_PANEL_CONFIGS: Record<ConfigurablePanel, PanelConfig> = {
    ticket: {
        title: 'Support Ticket Opened',
        description: '## Thanks {opener} for contacting support!\n\nThank you for opening a ticket with **Florida Roleplay**. {staff} will assist you as soon as possible. Please avoid pinging staff unless this ticket has gone unanswered for more than **12 hours**. If you are reporting a user, include their **User ID**, relevant **screenshots**, and a **clear explanation** below.\n\n**Ticket Information**\n› **Opener:** {opener}\n› **Ticket ID:** `{ticket_id}`\n› **Inquiry:** {inquiry}',
    },
    infraction: {
        title: 'Staff Infraction Issued',
        description: '> Hello **{member}**, a **{action}** has been placed on your staff record.\n\n› **Reason:** {reason}\n\n› **Infraction type:** {action}\n\n› **Issued by:** **{issuer}**\n\n› **Appeal status:** {appeal_status}',
    },
    promotion: {
        title: 'Staff Promotion',
        description: '*Authorized by **{promoter}***\n\n› **Promoted staff:** **{member}**\n\n› **Previous role:** {old_role}\n\n› **New role:** **{new_role}**\n\n› **Additional notes:** {notes}',
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
