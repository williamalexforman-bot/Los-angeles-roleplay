import { ChannelType, PermissionFlagsBits, type Client, type Guild, type GuildBasedChannel } from 'discord.js';
import { CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const TICKET_CATEGORIES = {
    general: process.env.GENERAL_TICKET_CATEGORY_ID || '1526254341646712883',
    internal: process.env.INTERNAL_TICKET_CATEGORY_ID || '1526254402426503320',
    management: process.env.MANAGEMENT_TICKET_CATEGORY_ID || '1526254462128099479',
    highrank: process.env.HIGH_RANK_TICKET_CATEGORY_ID || '1526254518570844231',
} as const;

const REQUIRED_TICKET_ROLES = {
    general: process.env.SUPPORT_ROLE_ID || process.env.GENERAL_SUPPORT_ROLE_ID || '1523122697746382868',
    internal: process.env.INTERNAL_AFFAIRS_ROLE_ID || '1521593407816990811',
} as const;

const OPTIONAL_TICKET_ROLES = {
    management: process.env.MANAGEMENT_ROLE_ID,
    highrank: process.env.HIGH_RANK_ROLE_ID,
} as const;

const CRITICAL_CHANNELS: Record<string, string> = {
    ticketPanel: process.env.TICKET_PANEL_CHANNEL_ID || '1526034504953892925',
    infractionParent: CHANNEL_IDS.infractionParent,
    promotions: CHANNEL_IDS.promotions,
    trainingResults: CHANNEL_IDS.trainingResults,
    suggestions: CHANNEL_IDS.suggestions,
    giveaways: CHANNEL_IDS.giveaways,
    partnershipRequests: CHANNEL_IDS.partnershipRequests,
    profanityLog: CHANNEL_IDS.profanityLog,
    discordCommandLog: CHANNEL_IDS.discordCommandLog,
};

function botPermissions(channel: GuildBasedChannel, guild: Guild): string[] {
    const me = guild.members.me;
    if (!me || !('permissionsFor' in channel) || typeof channel.permissionsFor !== 'function') return [];
    const permissions = channel.permissionsFor(me);
    if (!permissions) return [];
    const required = [
        ['ViewChannel', PermissionFlagsBits.ViewChannel],
        ['SendMessages', PermissionFlagsBits.SendMessages],
        ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ] as const;
    return required.filter(([, permission]) => !permissions.has(permission)).map(([name]) => name);
}

export async function runRuntimeIntegrityAudit(client: Client): Promise<void> {
    const configuredGuildId = process.env.GUILD_ID?.trim();
    const guild = configuredGuildId
        ? client.guilds.cache.get(configuredGuildId) || await client.guilds.fetch(configuredGuildId).catch(() => null)
        : client.guilds.cache.first();

    if (!guild) {
        logger.error('[IntegrityAudit] FAILED: no target guild is available. Check GUILD_ID and bot membership.');
        return;
    }

    const issues: string[] = [];
    const warnings: string[] = [];

    for (const [type, categoryId] of Object.entries(TICKET_CATEGORIES)) {
        const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
        if (!category) issues.push(`ticket category ${type} (${categoryId}) is missing`);
        else if (category.type !== ChannelType.GuildCategory) issues.push(`ticket category ${type} (${categoryId}) is not a category`);
    }

    for (const [type, roleId] of Object.entries(REQUIRED_TICKET_ROLES)) {
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!role) issues.push(`required ticket role ${type} (${roleId}) is missing`);
    }

    for (const [type, roleId] of Object.entries(OPTIONAL_TICKET_ROLES)) {
        if (!roleId) {
            warnings.push(`${type} ticket role is not configured; General Support fallback will be used`);
            continue;
        }
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!role) warnings.push(`${type} ticket role (${roleId}) is missing; General Support fallback will be used`);
    }

    for (const [name, channelId] of Object.entries(CRITICAL_CHANNELS)) {
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            issues.push(`critical channel ${name} (${channelId}) is missing`);
            continue;
        }
        if (!channel.isTextBased()) continue;
        const missing = botPermissions(channel, guild);
        if (missing.length) issues.push(`critical channel ${name} (${channelId}) missing bot permissions: ${missing.join(', ')}`);
    }

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) {
        issues.push('bot guild member could not be resolved');
    } else {
        const guildRequired = [
            ['ManageChannels', PermissionFlagsBits.ManageChannels],
            ['ViewChannel', PermissionFlagsBits.ViewChannel],
            ['SendMessages', PermissionFlagsBits.SendMessages],
        ] as const;
        const missingGuildPermissions = guildRequired
            .filter(([, permission]) => !me.permissions.has(permission))
            .map(([name]) => name);
        if (missingGuildPermissions.length) issues.push(`bot is missing guild permissions: ${missingGuildPermissions.join(', ')}`);
    }

    if (warnings.length) logger.warn(`[IntegrityAudit] WARN: ${warnings.join(' | ')}`);
    if (issues.length) {
        logger.error(`[IntegrityAudit] FAILED with ${issues.length} issue(s): ${issues.join(' | ')}`);
        return;
    }
    logger.info('[IntegrityAudit] PASSED: required ticket configuration, critical channels, and core bot permissions are valid.');
}
