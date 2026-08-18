import {
    AuditLogEvent,
    Client,
    EmbedBuilder,
    Events,
    Guild,
    GuildAuditLogsEntry,
    GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const AUDIT_ENTRY_MAX_AGE_MS = 15_000;
const PROCESSED_AUDIT_TTL_MS = 5 * 60_000;
const SECURITY_REASON = 'LARP Security: unauthorized server resource';

type SecurityResource = 'bot' | 'webhook' | 'integration';
type SecurityDecision = 'allowed' | 'blocked' | 'failed';

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

interface SecurityBaseline {
    webhookIds: Set<string> | null;
    integrationIds: Set<string> | null;
}

interface SecurityLogDetails {
    resource: SecurityResource;
    resourceId: string;
    resourceName: string;
    executorId: string | null;
    decision: SecurityDecision;
    action: string;
    detail: string;
}

const registeredClients = new WeakSet<Client>();
const baselines = new Map<string, SecurityBaseline>();
const processedAuditEntries = new Map<string, number>();
const targetLocks = new Map<string, Promise<boolean>>();

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
        enabled: (process.env.SECURITY_PROTECTION_ENABLED || 'true').toLowerCase() !== 'false',
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

function baselineFor(guildId: string): SecurityBaseline {
    let baseline = baselines.get(guildId);
    if (!baseline) {
        baseline = { webhookIds: null, integrationIds: null };
        baselines.set(guildId, baseline);
    }
    return baseline;
}

function pruneProcessedAuditEntries(): void {
    const cutoff = Date.now() - PROCESSED_AUDIT_TTL_MS;
    for (const [entryId, processedAt] of processedAuditEntries) {
        if (processedAt < cutoff) processedAuditEntries.delete(entryId);
    }
}

function auditWasProcessed(entryId: string): boolean {
    pruneProcessedAuditEntries();
    return processedAuditEntries.has(entryId);
}

async function withTargetLock(key: string, work: () => Promise<boolean>): Promise<boolean> {
    const active = targetLocks.get(key);
    if (active) return active;

    const pending = work().finally(() => {
        if (targetLocks.get(key) === pending) targetLocks.delete(key);
    });
    targetLocks.set(key, pending);
    return pending;
}

async function executorIsTrusted(
    guild: Guild,
    executorId: string | null,
    policy: ServerSecurityPolicy,
): Promise<boolean> {
    if (!executorId) return false;
    if (executorId === guild.ownerId || executorId === guild.client.user?.id) return true;
    if (policy.trustedUserIds.has(executorId)) return true;
    if (!policy.trustedRoleIds.size) return false;

    const member = await guild.members.fetch(executorId).catch(() => null);
    return Boolean(member?.roles.cache.some(role => policy.trustedRoleIds.has(role.id)));
}

function recentEntry(entry: GuildAuditLogsEntry, targetId?: string): boolean {
    if (Date.now() - entry.createdTimestamp > AUDIT_ENTRY_MAX_AGE_MS) return false;
    return !targetId || entry.targetId === targetId;
}

async function findRecentAuditEntry(
    guild: Guild,
    action: AuditLogEvent,
    targetId: string,
): Promise<GuildAuditLogsEntry | null> {
    const delays = [0, 250, 700];
    for (const delay of delays) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const logs = await guild.fetchAuditLogs({ limit: 6, type: action }).catch(() => null);
        const entry = logs?.entries.find(candidate => recentEntry(candidate, targetId));
        if (entry) return entry;
    }
    return null;
}

async function sendSecurityLog(
    guild: Guild,
    details: SecurityLogDetails,
    policy: ServerSecurityPolicy,
): Promise<void> {
    const channel = await guild.client.channels.fetch(policy.logChannelId).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[Server Security] ${details.decision.toUpperCase()} ${details.resource} ${details.resourceId}: ${details.detail}`);
        return;
    }

    const color = details.decision === 'allowed' ? 0x22c55e : details.decision === 'blocked' ? 0xef4444 : 0xf59e0b;
    const title = details.decision === 'allowed'
        ? 'Authorized Server Security Change'
        : details.decision === 'blocked'
            ? 'Unauthorized Server Change Blocked'
            : 'Server Security Action Failed';
    const executor = details.executorId ? `<@${details.executorId}> (\`${details.executorId}\`)` : 'Unknown / audit log unavailable';
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(details.detail)
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Resource', value: `${details.resourceName}\n\`${details.resourceId}\``, inline: true },
            { name: 'Type', value: details.resource, inline: true },
            { name: 'Executor', value: executor, inline: false },
            { name: 'Action', value: details.action, inline: false },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();

    const shouldAlert = details.decision !== 'allowed' && Boolean(policy.alertRoleId);
    await channel.send(legacyEmbedToV2Message(embed, {
        content: shouldAlert ? `<@&${policy.alertRoleId}>` : undefined,
        allowedMentions: shouldAlert
            ? { parse: [], roles: [policy.alertRoleId!] }
            : { parse: [] },
    })).catch(error => {
        logger.warn(`[Server Security] Could not publish security log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function evaluateBotAddition(
    member: GuildMember,
    entry: GuildAuditLogsEntry | null,
    policy: ServerSecurityPolicy,
): Promise<boolean> {
    const executorId = entry?.executorId || null;
    if (member.id === member.client.user.id || policy.allowedBotIds.has(member.id)) {
        await sendSecurityLog(member.guild, {
            resource: 'bot', resourceId: member.id, resourceName: member.user.tag,
            executorId, decision: 'allowed', action: 'No action', detail: 'The bot is explicitly allowlisted.',
        }, policy);
        return true;
    }

    if (await executorIsTrusted(member.guild, executorId, policy)) {
        await sendSecurityLog(member.guild, {
            resource: 'bot', resourceId: member.id, resourceName: member.user.tag,
            executorId, decision: 'allowed', action: 'No action', detail: 'A trusted server owner, user, role, or this security bot added the bot.',
        }, policy);
        return true;
    }

    try {
        if (policy.botAction === 'kick') await member.kick(`${SECURITY_REASON}: bot addition`);
        else await member.ban({ reason: `${SECURITY_REASON}: bot addition`, deleteMessageSeconds: 0 });
        await sendSecurityLog(member.guild, {
            resource: 'bot', resourceId: member.id, resourceName: member.user.tag,
            executorId, decision: 'blocked', action: policy.botAction === 'kick' ? 'Bot kicked' : 'Bot banned',
            detail: entry
                ? 'The bot was added by an executor who is not trusted by the security policy.'
                : 'The bot was not allowlisted and no matching audit-log attribution could be verified, so the fail-closed policy removed it.',
        }, policy);
        return true;
    } catch (error) {
        await sendSecurityLog(member.guild, {
            resource: 'bot', resourceId: member.id, resourceName: member.user.tag,
            executorId, decision: 'failed', action: `Could not ${policy.botAction} bot`,
            detail: `Discord rejected the automatic action. Check the bot's role hierarchy and Ban/Kick Members permission. ${error instanceof Error ? error.message : ''}`.trim(),
        }, policy);
        return false;
    }
}

export async function handleSecurityBotJoin(
    member: GuildMember,
    policy = loadServerSecurityPolicy(),
): Promise<void> {
    if (!policy.enabled || !member.user.bot) return;
    const entry = await findRecentAuditEntry(member.guild, AuditLogEvent.BotAdd, member.id);
    if (entry && auditWasProcessed(entry.id)) return;

    await withTargetLock(`${member.guild.id}:bot:${member.id}`, async () => {
        if (entry && auditWasProcessed(entry.id)) return true;
        const handled = await evaluateBotAddition(member, entry, policy);
        if (handled && entry) processedAuditEntries.set(entry.id, Date.now());
        return handled;
    });
}

async function evaluateWebhook(
    guild: Guild,
    webhookId: string,
    entry: GuildAuditLogsEntry | null,
    policy: ServerSecurityPolicy,
): Promise<boolean> {
    const webhooks = await guild.fetchWebhooks().catch(() => null);
    const webhook = webhooks?.get(webhookId);
    if (!webhook) {
        baselineFor(guild.id).webhookIds?.delete(webhookId);
        // Audit entries can arrive a fraction of a second before Discord's
        // webhook list reflects the change. Leave the entry unprocessed so the
        // WebhooksUpdate fallback can retry it with the original attribution.
        return false;
    }

    const executorId = entry?.executorId || null;
    if (policy.allowedWebhookIds.has(webhookId) || await executorIsTrusted(guild, executorId, policy)) {
        baselineFor(guild.id).webhookIds?.add(webhookId);
        await sendSecurityLog(guild, {
            resource: 'webhook', resourceId: webhookId, resourceName: webhook.name,
            executorId, decision: 'allowed', action: 'No action',
            detail: policy.allowedWebhookIds.has(webhookId) ? 'The webhook is explicitly allowlisted.' : 'A trusted executor created or updated this webhook.',
        }, policy);
        return true;
    }

    try {
        await webhook.delete(`${SECURITY_REASON}: webhook create/update`);
        baselineFor(guild.id).webhookIds?.delete(webhookId);
        await sendSecurityLog(guild, {
            resource: 'webhook', resourceId: webhookId, resourceName: webhook.name,
            executorId, decision: 'blocked', action: 'Webhook deleted',
            detail: entry
                ? 'An untrusted executor created or updated this webhook.'
                : 'A new webhook appeared without trusted audit-log attribution and was deleted by the fail-closed policy.',
        }, policy);
        return true;
    } catch (error) {
        await sendSecurityLog(guild, {
            resource: 'webhook', resourceId: webhookId, resourceName: webhook.name,
            executorId, decision: 'failed', action: 'Could not delete webhook',
            detail: `Discord rejected the automatic action. Check Manage Webhooks permission. ${error instanceof Error ? error.message : ''}`.trim(),
        }, policy);
        return false;
    }
}

async function evaluateIntegration(
    guild: Guild,
    integrationId: string,
    entry: GuildAuditLogsEntry | null,
    policy: ServerSecurityPolicy,
): Promise<boolean> {
    const integrations = await guild.fetchIntegrations().catch(() => null);
    const integration = integrations?.get(integrationId);
    if (!integration) {
        baselineFor(guild.id).integrationIds?.delete(integrationId);
        // Keep the audit entry retryable when the gateway event wins the race
        // against Discord's integrations REST endpoint.
        return false;
    }

    const executorId = entry?.executorId || null;
    if (policy.allowedIntegrationIds.has(integrationId) || await executorIsTrusted(guild, executorId, policy)) {
        baselineFor(guild.id).integrationIds?.add(integrationId);
        await sendSecurityLog(guild, {
            resource: 'integration', resourceId: integrationId, resourceName: integration.name,
            executorId, decision: 'allowed', action: 'No action',
            detail: policy.allowedIntegrationIds.has(integrationId) ? 'The integration is explicitly allowlisted.' : 'A trusted executor created or updated this integration.',
        }, policy);
        return true;
    }

    try {
        await integration.delete(`${SECURITY_REASON}: integration create/update`);
        baselineFor(guild.id).integrationIds?.delete(integrationId);
        await sendSecurityLog(guild, {
            resource: 'integration', resourceId: integrationId, resourceName: integration.name,
            executorId, decision: 'blocked', action: 'Integration deleted',
            detail: entry
                ? 'An untrusted executor created or updated this server integration.'
                : 'A new integration appeared without trusted audit-log attribution and was deleted by the fail-closed policy.',
        }, policy);
        return true;
    } catch (error) {
        await sendSecurityLog(guild, {
            resource: 'integration', resourceId: integrationId, resourceName: integration.name,
            executorId, decision: 'failed', action: 'Could not delete integration',
            detail: `Discord rejected the automatic action. Check Manage Server permission. ${error instanceof Error ? error.message : ''}`.trim(),
        }, policy);
        return false;
    }
}

function resourceForAuditEntry(entry: GuildAuditLogsEntry): SecurityResource | null {
    if (entry.action === AuditLogEvent.BotAdd) return 'bot';
    if (entry.action === AuditLogEvent.WebhookCreate || entry.action === AuditLogEvent.WebhookUpdate) return 'webhook';
    if (entry.action === AuditLogEvent.IntegrationCreate || entry.action === AuditLogEvent.IntegrationUpdate) return 'integration';
    return null;
}

export async function handleSecurityAuditEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
    policy = loadServerSecurityPolicy(),
): Promise<void> {
    if (!policy.enabled || auditWasProcessed(entry.id) || !recentEntry(entry)) return;
    const resource = resourceForAuditEntry(entry);
    const targetId = entry.targetId;
    if (!resource || !targetId) return;

    await withTargetLock(`${guild.id}:${resource}:${targetId}`, async () => {
        if (auditWasProcessed(entry.id)) return true;
        let handled = false;
        if (resource === 'bot') {
            const member = await guild.members.fetch(targetId).catch(() => null);
            handled = member ? (member.user.bot ? await evaluateBotAddition(member, entry, policy) : true) : false;
        } else if (resource === 'webhook') {
            handled = await evaluateWebhook(guild, targetId, entry, policy);
        } else {
            handled = await evaluateIntegration(guild, targetId, entry, policy);
        }
        if (handled) processedAuditEntries.set(entry.id, Date.now());
        return handled;
    });
}

async function recentSecurityEntries(guild: Guild, actions: Set<AuditLogEvent>): Promise<GuildAuditLogsEntry[]> {
    const logs = await guild.fetchAuditLogs({ limit: 12 }).catch(() => null);
    if (!logs) return [];
    return [...logs.entries.values()].filter(entry => actions.has(entry.action) && recentEntry(entry));
}

async function sweepWebhooks(guild: Guild, policy: ServerSecurityPolicy): Promise<void> {
    await withTargetLock(`${guild.id}:webhook:sweep`, async () => {
        const baseline = baselineFor(guild.id);
        const current = await guild.fetchWebhooks().catch(() => null);
        if (!current) return false;
        if (!baseline.webhookIds) {
            const entries = await recentSecurityEntries(guild, new Set([AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate]));
            for (const entry of entries) await handleSecurityAuditEntry(entry, guild, policy);
            const refreshed = await guild.fetchWebhooks().catch(() => current);
            baseline.webhookIds = new Set(refreshed.keys());
            return true;
        }

        const entries = await recentSecurityEntries(guild, new Set([AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate]));
        for (const entry of entries) await handleSecurityAuditEntry(entry, guild, policy);
        const attributedIds = new Set(entries
            .filter(entry => auditWasProcessed(entry.id))
            .map(entry => entry.targetId)
            .filter((id): id is string => Boolean(id)));

        for (const webhookId of current.keys()) {
            if (baseline.webhookIds.has(webhookId) || policy.allowedWebhookIds.has(webhookId) || attributedIds.has(webhookId)) continue;
            await withTargetLock(`${guild.id}:webhook:${webhookId}`, () => evaluateWebhook(guild, webhookId, null, policy));
        }
        return true;
    });
}

async function sweepIntegrations(guild: Guild, policy: ServerSecurityPolicy): Promise<void> {
    await withTargetLock(`${guild.id}:integration:sweep`, async () => {
        const baseline = baselineFor(guild.id);
        const current = await guild.fetchIntegrations().catch(() => null);
        if (!current) return false;
        if (!baseline.integrationIds) {
            const entries = await recentSecurityEntries(guild, new Set([AuditLogEvent.IntegrationCreate, AuditLogEvent.IntegrationUpdate]));
            for (const entry of entries) await handleSecurityAuditEntry(entry, guild, policy);
            const refreshed = await guild.fetchIntegrations().catch(() => current);
            baseline.integrationIds = new Set(refreshed.keys());
            return true;
        }

        const entries = await recentSecurityEntries(guild, new Set([AuditLogEvent.IntegrationCreate, AuditLogEvent.IntegrationUpdate]));
        for (const entry of entries) await handleSecurityAuditEntry(entry, guild, policy);
        const attributedIds = new Set(entries
            .filter(entry => auditWasProcessed(entry.id))
            .map(entry => entry.targetId)
            .filter((id): id is string => Boolean(id)));

        for (const integrationId of current.keys()) {
            if (baseline.integrationIds.has(integrationId) || policy.allowedIntegrationIds.has(integrationId) || attributedIds.has(integrationId)) continue;
            await withTargetLock(`${guild.id}:integration:${integrationId}`, () => evaluateIntegration(guild, integrationId, null, policy));
        }
        return true;
    });
}

async function initializeGuildSecurity(guild: Guild): Promise<void> {
    const [webhooks, integrations] = await Promise.all([
        guild.fetchWebhooks().catch(() => null),
        guild.fetchIntegrations().catch(() => null),
    ]);
    baselines.set(guild.id, {
        webhookIds: webhooks ? new Set(webhooks.keys()) : null,
        integrationIds: integrations ? new Set(integrations.keys()) : null,
    });

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        logger.warn(`[Server Security] ${guild.name}: View Audit Log is missing; fail-closed fallback detection remains active but attribution may be unavailable.`);
    }
    if (!me?.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
        logger.warn(`[Server Security] ${guild.name}: Manage Webhooks is missing; unauthorized webhook deletion will fail.`);
    }
    if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        logger.warn(`[Server Security] ${guild.name}: Manage Server is missing; unauthorized integration deletion may fail.`);
    }
    if (!me?.permissions.has(PermissionFlagsBits.BanMembers) && !me?.permissions.has(PermissionFlagsBits.KickMembers)) {
        logger.warn(`[Server Security] ${guild.name}: Ban/Kick Members is missing; unauthorized bot removal will fail.`);
    }
}

export async function registerServerSecurity(client: Client): Promise<void> {
    const policy = loadServerSecurityPolicy();
    if (!policy.enabled) {
        logger.warn('[Server Security] Disabled by SECURITY_PROTECTION_ENABLED=false.');
        return;
    }
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.GuildMemberAdd, member => {
        void handleSecurityBotJoin(member, policy).catch(error => {
            logger.error(`[Server Security] Bot-add guard crashed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
        void handleSecurityAuditEntry(entry, guild, policy).catch(error => {
            logger.error(`[Server Security] Audit-log guard crashed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on(Events.WebhooksUpdate, channel => {
        void sweepWebhooks(channel.guild, policy).catch(error => {
            logger.error(`[Server Security] Webhook sweep crashed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on(Events.GuildIntegrationsUpdate, guild => {
        void sweepIntegrations(guild, policy).catch(error => {
            logger.error(`[Server Security] Integration sweep crashed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
    client.on(Events.GuildCreate, guild => {
        void initializeGuildSecurity(guild).catch(error => {
            logger.error(`[Server Security] Could not initialize ${guild.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    await Promise.allSettled([...client.guilds.cache.values()].map(guild => initializeGuildSecurity(guild)));
    logger.info('[Server Security] Active: unauthorized bots, webhooks, and integrations are blocked with audit-log attribution and fail-closed fallback detection.');
}

export function resetServerSecurityStateForTests(): void {
    baselines.clear();
    processedAuditEntries.clear();
    targetLocks.clear();
}
