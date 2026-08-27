import type {
    Client,
    Guild,
    GuildAuditLogsEntry,
    GuildMember,
} from 'discord.js';
import { CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * TEMPORARILY DISABLED BY OWNER REQUEST.
 *
 * This module previously removed Discord bot accounts that were added by an
 * executor who was not trusted/allowlisted. It also posted the
 * "Unauthorized Server Change Blocked" / "Bot banned" security message.
 *
 * Until the owner explicitly asks to turn this protection back on, this file
 * is intentionally fail-open: it does not kick, ban, delete, alert, or register
 * any security listeners.
 */

export interface ServerSecurityPolicy {
    enabled: boolean;
    trustedUserIds: Set<string>;
    trustedRoleIds: Set<string>;
    allowedBotIds: Set<string>;
    allowedWebhookIds: Set<string>;
    allowedIntegrationIds: Set<string>;
    botAction: 'ban' | 'kick';
    logChannelId: string;
    alertRoleId?: string;
}

function idSet(value: string | undefined): Set<string> {
    return new Set(
        (value || '')
            .split(',')
            .map(id => id.trim())
            .filter(id => /^\d{15,22}$/.test(id)),
    );
}

export function loadServerSecurityPolicy(): ServerSecurityPolicy {
    return {
        // HARD OFF until the owner explicitly requests re-enabling it.
        enabled: false,
        trustedUserIds: idSet(process.env.SECURITY_TRUSTED_USER_IDS),
        trustedRoleIds: idSet(process.env.SECURITY_TRUSTED_ROLE_IDS),
        allowedBotIds: idSet(process.env.SECURITY_ALLOWED_BOT_IDS),
        allowedWebhookIds: idSet(process.env.SECURITY_ALLOWED_WEBHOOK_IDS),
        allowedIntegrationIds: idSet(process.env.SECURITY_ALLOWED_INTEGRATION_IDS),
        botAction: process.env.SECURITY_UNAUTHORIZED_BOT_ACTION?.toLowerCase() === 'kick' ? 'kick' : 'ban',
        logChannelId: process.env.SECURITY_LOG_CHANNEL_ID || CHANNEL_IDS.raidThreatLog,
        alertRoleId: process.env.SECURITY_ALERT_ROLE_ID || process.env.EMERGENCY_STAFF_ROLE_ID || undefined,
    };
}

export async function handleSecurityBotJoin(
    member: GuildMember,
    _policy = loadServerSecurityPolicy(),
): Promise<void> {
    if (member.user.bot) {
        logger.info(`[Server Security] Ignored bot join ${member.id}; automatic bot removal is disabled.`);
    }
}

export async function handleSecurityAuditEntry(
    _entry: GuildAuditLogsEntry,
    _guild: Guild,
    _policy = loadServerSecurityPolicy(),
): Promise<void> {
    // Intentionally disabled. Do not remove resources or send security alerts.
}

export async function registerServerSecurity(_client: Client): Promise<void> {
    // Do not attach GuildMemberAdd, audit-log, webhook, integration, or guild
    // listeners while the temporary owner lockdown is active.
    logger.warn('[Server Security] HARD DISABLED: no bot joins are kicked/banned and no unauthorized-join alerts are sent.');
}

export function resetServerSecurityStateForTests(): void {
    // No runtime state exists while Server Security is disabled.
}
