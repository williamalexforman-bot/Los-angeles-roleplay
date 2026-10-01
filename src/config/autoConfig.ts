import { ChannelType, Guild, type GuildBasedChannel, type Role } from 'discord.js';
import { applyRuntimeConfiguration } from './constants';
import { logger } from '../utils/logger';

type Named = { id: string; name: string };

const CHANNEL_ALIASES: Record<string, string[]> = {
    TICKET_PANEL_CHANNEL_ID: ['ticket-panel', 'tickets', 'support', 'support-tickets', 'open-a-ticket'],
    TICKET_TRANSCRIPT_CHANNEL_ID: ['ticket-transcripts', 'transcripts', 'ticket-logs'],
    CSRP_RULES_CHANNEL_ID: ['regulations', 'rules', 'server-rules'],
    PAID_PARTNER_CHANNEL_ID: ['paid-partner', 'paid-partnerships'],
    PROFANITY_LOG_CHANNEL_ID: ['profanity-logs', 'automod-logs', 'moderation-logs'],
    ERLC_COMMAND_LOG_CHANNEL_ID: ['erlc-command-logs', 'command-logs'],
    DISCORD_COMMAND_LOG_CHANNEL_ID: ['discord-command-logs', 'bot-logs', 'command-logs', 'logs'],
    ERLC_TEAM_CHANGE_LOG_CHANNEL_ID: ['team-change-logs', 'team-changes'],
    ERLC_PUNISHMENT_LOG_CHANNEL_ID: ['erlc-punishment-logs', 'punishment-logs'],
    TRAINING_RESULTS_CHANNEL_ID: ['training-results', 'training-result'],
    INFRACTION_PARENT_CHANNEL_ID: ['infractions', 'staff-infractions'],
    STAFF_FEEDBACK_CHANNEL_ID: ['staff-feedback'],
    MOVIE_FEEDBACK_CHANNEL_ID: ['movie-feedback'],
    PARTNERSHIP_APPROVAL_CHANNEL_ID: ['partnership-approvals', 'partnership-approval'],
    PARTNERSHIP_REQUEST_CHANNEL_ID: ['partnership-requests', 'partnership-request'],
    STAFF_COMPLAINT_CHANNEL_ID: ['staff-complaints', 'staff-complaint'],
    PRIVATE_AUDIT_LOG_CHANNEL_ID: ['private-audit-logs', 'audit-logs'],
    PROMOTION_CHANNEL_ID: ['promotions', 'promotion-logs'],
    APPLICATION_CHANNEL_ID: ['applications', 'application-results'],
    TRAINING_CHANNEL_ID: ['trainings', 'training'],
    JOIN_LOG_CHANNEL_ID: ['welcome', 'joins', 'join-logs'],
    LEAVE_LOG_CHANNEL_ID: ['leaves', 'leave-logs'],
    DISCORD_KICK_LOG_CHANNEL_ID: ['kick-logs', 'moderation-logs'],
    DISCORD_BAN_LOG_CHANNEL_ID: ['ban-logs', 'moderation-logs'],
    LOG_CHANNEL_ID: ['bot-logs', 'logs'],
};

const ROLE_ALIASES: Record<string, string[]> = {
    BOT_PERMISSIONS_ROLE_ID: ['bot-permissions', 'bot-manager', 'bot-management'],
    ADMIN_ROLE_ID: ['administrator', 'admin'],
    HIGH_RANK_ROLE_ID: ['high-command', 'high-rank'],
    GENERAL_SUPPORT_ROLE_ID: ['general-support', 'support-team'],
    MANAGEMENT_ROLE_ID: ['management', 'server-management'],
    INTERNAL_AFFAIRS_ROLE_ID: ['internal-affairs'],
    SUPPORT_ROLE_ID: ['support', 'staff'],
    PARTNERSHIP_ROLE_ID: ['partner', 'partners'],
};

const CATEGORY_ALIASES: Record<string, string[]> = {
    GENERAL_SUPPORT_CATEGORY_ID: ['general-support', 'support-tickets', 'tickets'],
    INTERNAL_AFFAIRS_CATEGORY_ID: ['internal-affairs'],
    MANAGEMENT_CATEGORY_ID: ['management'],
    HIGH_RANK_CATEGORY_ID: ['high-rank', 'high-command'],
};

function normalized(value: string): string {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function selectByAliases<T extends Named>(items: Iterable<T>, aliases: string[]): T | undefined {
    const indexed = new Map<string, T>();
    for (const item of items) indexed.set(normalized(item.name), item);
    for (const alias of aliases) {
        const match = indexed.get(normalized(alias));
        if (match) return match;
    }
    return undefined;
}

function configureMissing<T extends Named>(
    definitions: Record<string, string[]>,
    items: Iterable<T>,
    configured: string[],
): void {
    for (const [key, aliases] of Object.entries(definitions)) {
        if (process.env[key]?.trim()) continue;
        const match = selectByAliases(items, aliases);
        if (!match) continue;
        process.env[key] = match.id;
        configured.push(`${key}=#${match.name}`);
    }
}

export async function autoConfigureGuild(guild: Guild): Promise<void> {
    process.env.GUILD_ID = guild.id;
    await Promise.allSettled([guild.channels.fetch(), guild.roles.fetch()]);

    const textChannels = [...guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement,
    ).values()] as Array<GuildBasedChannel & Named>;
    const categories = [...guild.channels.cache.filter(channel => channel.type === ChannelType.GuildCategory)
        .values()] as Array<GuildBasedChannel & Named>;
    const roles = [...guild.roles.cache.filter(role => !role.managed && role.id !== guild.id).values()] as Role[];
    const configured: string[] = [];

    configureMissing(CHANNEL_ALIASES, textChannels, configured);
    configureMissing(CATEGORY_ALIASES, categories, configured);
    configureMissing(ROLE_ALIASES, roles, configured);

    // A single general log channel is a safe fallback for specialized log destinations.
    const generalLog = process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
    if (generalLog) {
        for (const key of [
            'PROFANITY_LOG_CHANNEL_ID',
            'DISCORD_KICK_LOG_CHANNEL_ID',
            'DISCORD_BAN_LOG_CHANNEL_ID',
            'PRIVATE_AUDIT_LOG_CHANNEL_ID',
        ]) {
            if (!process.env[key]) process.env[key] = generalLog;
        }
    }

    applyRuntimeConfiguration();
    logger.info(configured.length
        ? `Auto-configured ${configured.length} server setting(s): ${configured.join(', ')}`
        : 'Server channel and role configuration loaded; no automatic changes were needed.');
}
