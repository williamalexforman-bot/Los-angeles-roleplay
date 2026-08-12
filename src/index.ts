import 'dotenv/config';
import {
    AuditLogEvent,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import type { Server } from 'http';
import { interactionCreate } from './handlers/interactionCreate';
import { onReady } from './events/ready';
import { startWebhookServer } from './webhook/server';
import { connectDatabase, disconnectDatabase } from './database/connection';
import { configureInfractionDatabaseAdapter } from './database/infractionAdapter';
import { handleMessageModeration } from './events/messageModeration';
// economy message handler removed
import { startErlcMonitor, type ErlcMonitor } from './monitors/erlcMonitor';
import { MongoErlcMonitorStateStore } from './database/erlcStateStore';
import { BRAND, CHANNEL_IDS, INFRACTION_AUTHORIZED_ROLE_ID } from './config/constants';
import { createLogoAttachment } from './utils/embeds';
import { logger } from './utils/logger';
import { configureInfractionAuthorization } from './commands/staffManagement';
import { getDiscordBotToken } from './config/env';
import { setDiscordClientForDm } from './commands/punishment';
import { sendPunishmentDm, handleAppealDmMessage, setBanAppealClient } from './commands/banAppeal';

// Crash-proof error handling — keeps the process alive on errors and prevents premature exit
process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`[Process] Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (error: Error) => {
    logger.error(`[Process] Uncaught exception: ${error.message}`);
    // Keep the process alive so PM2 / platform can restart gracefully
    process.exitCode = 1;
});
process.on('exit', (code: number) => {
    logger.info(`[Process] Exiting with code ${code}.`);
});

// Keep-alive timer to prevent event loop from emptying if all timers/promises resolve
setInterval(() => {}, 60_000);

const enablePrivileged = (process.env.ENABLE_PRIVILEGED_INTENTS || 'false').toLowerCase() === 'true';
let erlcMonitor: ErlcMonitor | null = null;
let webhookServer: Server | null = null;
const rapidJoinStates = new Map<string, { joins: number[]; lastAlertAt: number }>();

let loginRetryCount = 0;
const MAX_LOGIN_RETRIES = 5;

async function recoverDiscordClient(bot: Client, token: string, privileged: boolean): Promise<void> {
    logger.info('[Recovery] Attempting to reinitialize the Discord client after disconnection...');
    try {
        bot.destroy();
    } catch {
        // ignore destroy errors during recovery
    }
    const replacement = createConfiguredClient(privileged);
    (globalThis as Record<string, unknown>).__discordClient = replacement;
    client = replacement;
    try {
        await replacement.login(token);
        logger.info('[Recovery] Discord client reconnected successfully.');
        loginRetryCount = 0;
    } catch (loginError) {
        logger.error(`[Recovery] Re-login failed: ${loginError instanceof Error ? loginError.message : 'Unknown'}`);
        throw loginError;
    }
}

function createConfiguredClient(privilegedIntents: boolean): Client {
    const intents = [GatewayIntentBits.Guilds];
    if (privilegedIntents) {
        intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    } else {
        logger.warn('Running without privileged intents; message moderation and member events are disabled until enabled in the Discord Developer Portal.');
    }
    const bot = new Client({ intents });
    bot.on('interactionCreate', interactionCreate);

    // Auto-reconnect when Discord disconnects (e.g., network interruption, gateway reconnect)
    bot.on('disconnect', () => {
        logger.warn('[Recovery] Discord client disconnected. Will attempt to reconnect...');
        const token = getDiscordBotToken();
        if (token && loginRetryCount < MAX_LOGIN_RETRIES) {
            loginRetryCount++;
            const delay = Math.min(loginRetryCount * 10_000, 60_000);
            setTimeout(() => {
                recoverDiscordClient(bot, token, enablePrivileged).catch(recoveryError => {
                    logger.error(`[Recovery] Reconnect after disconnect failed: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown'}`);
                });
            }, delay);
        }
    });

    // Reconnection logic on fatal Discord client errors
    bot.on('error', async (error: Error) => {
        logger.error(`Discord client error: ${error.message}`);
        const errorMsg = error.message.toLowerCase();
        // Trigger reconnection on gateway/disconnect/rate-limit fatal errors
        if (
            errorMsg.includes('disallowed intents')
            || errorMsg.includes('invalid token')
            || errorMsg.includes('shard')
            || errorMsg.includes('connection')
            || errorMsg.includes('timeout')
            || errorMsg.includes('websocket')
            || errorMsg.includes('eternal')
            || errorMsg.includes('rate limit')
        ) {
            const token = getDiscordBotToken();
            if (token && loginRetryCount < MAX_LOGIN_RETRIES) {
                loginRetryCount++;
                const delay = Math.min(loginRetryCount * 10_000, 60_000);
                logger.info(`[Recovery] Will attempt reconnection in ${delay / 1_000}s (attempt ${loginRetryCount}/${MAX_LOGIN_RETRIES})...`);
                setTimeout(() => {
                    recoverDiscordClient(bot, token, enablePrivileged).catch(recoveryError => {
                        logger.error(`[Recovery] Failed to reconnect: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown'}`);
                    });
                }, delay);
            } else if (loginRetryCount >= MAX_LOGIN_RETRIES) {
                logger.error('[Recovery] Max reconnection attempts reached. The bot will remain offline until restarted manually.');
            }
        }
    });

    bot.once(Events.ClientReady, async () => {
        await onReady(bot);
        if (!process.env.BOT_PERMISSIONS_ROLE_ID) {
            logger.warn('BOT_PERMISSIONS_ROLE_ID is not configured; error and moderation commands remain restricted.');
        }
        if (!process.env.EMERGENCY_STAFF_ROLE_ID) {
            logger.warn('EMERGENCY_STAFF_ROLE_ID is not configured; High-confidence raid alerts will log without a role ping.');
        }
        if (!process.env.ERLC_SERVER_KEY) {
            logger.warn('ERLC_SERVER_KEY is not configured; ER:LC monitoring is disabled.');
            return;
        }
        // OOM fix — set DISABLE_ERLC_MONITOR=true on bot-hosting.net to save ~50MB RAM
        if (process.env.DISABLE_ERLC_MONITOR === 'true') {
            logger.info('ER:LC monitor disabled via DISABLE_ERLC_MONITOR=true (saves memory).');
            return;
        }
        const guildId = process.env.GUILD_ID || bot.guilds.cache.firstKey();
        if (!guildId) {
            logger.warn('ER:LC monitoring could not start because no Discord guild is available.');
            return;
        }
        try {
            erlcMonitor = await startErlcMonitor(bot, {
                stateStore: new MongoErlcMonitorStateStore(guildId),
                pollIntervalMs: Number(process.env.ERLC_POLL_INTERVAL_MS || 30_000),
                onError: (error, context) => logger.warn(`ER:LC monitor ${context}: ${error.message}`),
            });
            logger.info('ER:LC v2 monitor started.');
        } catch (error) {
            logger.warn(`ER:LC monitor is unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    if (privilegedIntents) {
        const formatRoleSummary = (roles: readonly string[] | Set<string>, guildRoles: Map<string, string>): string => {
            const ids = Array.isArray(roles) ? roles : [...roles];
            const visible = ids.filter(id => id !== guildRoles.get('everyone')).slice(0, 12);
            if (!visible.length) return 'None';
            return visible.map(roleId => `<@&${roleId}>`).join(' • ');
        };

        const accountCreatedField = (userId: string): { name: string; value: string; inline: true } => {
            const timestamp = Math.floor(Number(BigInt(userId) >> 22n) / 1000);
            return { name: 'Account Created', value: `<t:${timestamp}:F> • <t:${timestamp}:R>`, inline: true };
        };

        bot.on('guildMemberAdd', async member => {
            const joinChannelId = process.env.JOIN_LOG_CHANNEL_ID || '1529283685168447698';
            const joinChannel = await member.client.channels.fetch(joinChannelId).catch(() => null);
            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('Member Joined')
                .setDescription(`<@${member.id}> has joined the server.`)
                .setThumbnail(member.user.displayAvatarURL())
                .addFields(
                    { name: 'Discord Tag', value: member.user.tag, inline: true },
                    accountCreatedField(member.id),
                    { name: 'Joined Server', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>` : 'Unknown', inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            if (joinChannel?.isSendable()) {
                await joinChannel.send({ embeds: [embed], files: [createLogoAttachment()] }).catch(() => undefined);
            }

            const now = Date.now();
            const state = rapidJoinStates.get(member.guild.id) || { joins: [], lastAlertAt: 0 };
            state.joins.push(now);
            while (state.joins.length && now - state.joins[0] > 10_000) state.joins.shift();
            rapidJoinStates.set(member.guild.id, state);
            if (state.joins.length < 5 || now - state.lastAlertAt < 60_000) return;
            state.lastAlertAt = now;

            const raidChannel = await member.client.channels.fetch(CHANNEL_IDS.raidThreatLog).catch(() => null);
            if (!raidChannel?.isSendable()) return;
            const emergencyRoleId = process.env.EMERGENCY_STAFF_ROLE_ID;
            const alertEmbed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('Rapid Join Alert')
                .setDescription('A burst of new members may require staff review. No automatic moderation action was taken.')
                .setThumbnail(BRAND.logoUrl)
                .addFields(
                    { name: 'Joins Detected', value: `${state.joins.length} within 10 seconds`, inline: true },
                    { name: 'Confidence', value: 'High', inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();
            await raidChannel.send({
                content: emergencyRoleId ? `<@&${emergencyRoleId}>` : undefined,
                embeds: [alertEmbed],
                files: [createLogoAttachment()],
                allowedMentions: emergencyRoleId ? { roles: [emergencyRoleId] } : { parse: [] },
            }).catch(() => undefined);
        });

        bot.on('guildMemberRemove', async member => {
            const leaveChannelId = process.env.LEAVE_LOG_CHANNEL_ID || '1529283711466606815';
            const leaveChannel = await member.client.channels.fetch(leaveChannelId).catch(() => null);
            const roles = member.roles.cache
                ? Array.from(member.roles.cache.keys()).filter(roleId => roleId !== member.guild.roles.everyone.id)
                : [];
            const leaveEmbed = new EmbedBuilder()
                .setColor(0xf59e0b)
                .setTitle('Member Left')
                .setDescription(`<@${member.id}> has left the server.`)
                .setThumbnail(member.user.displayAvatarURL())
                .addFields(
                    { name: 'Discord Tag', value: member.user.tag, inline: true },
                    accountCreatedField(member.id),
                    { name: 'Roles Before Leave', value: roles.length ? roles.map(roleId => `<@&${roleId}>`).join(' • ') : 'None', inline: false },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();
            if (leaveChannel?.isSendable()) {
                await leaveChannel.send({ embeds: [leaveEmbed], files: [createLogoAttachment()] }).catch(() => undefined);
            }

            try {
                const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
                const entry = logs.entries.first();
                if (entry?.targetId !== member.id) return;
                const kickChannelId = process.env.DISCORD_KICK_LOG_CHANNEL_ID || '1529286532706467922';
                const kickChannel = await member.client.channels.fetch(kickChannelId).catch(() => null);
                if (!kickChannel?.isSendable()) return;

                const kickEmbed = new EmbedBuilder()
                    .setColor(0xef4444)
                    .setTitle('Member Kicked')
                    .setDescription(`<@${member.id}> was kicked by <@${entry.executor?.id}>.`)
                    .setThumbnail(member.user.displayAvatarURL())
                    .addFields(
                        { name: 'Discord Tag', value: member.user.tag, inline: true },
                        accountCreatedField(member.id),
                        { name: 'Kick Reason', value: entry.reason ? entry.reason : 'Unspecified', inline: false },
                        { name: 'Roles Before Kick', value: roles.length ? roles.map(roleId => `<@&${roleId}>`).join(' • ') : 'None', inline: false },
                    )
                    .setFooter({ text: BRAND.footer })
                    .setTimestamp();
                await kickChannel.send({ embeds: [kickEmbed], files: [createLogoAttachment()] }).catch(() => undefined);

                // DM the kicked user
                await sendPunishmentDm(bot, member.id, 'kick', entry.reason || 'No reason provided.', member.guild.name).catch(() => undefined);
            } catch {
                // Ignore audit-log failures.
            }
        });

        bot.on('guildBanAdd', async ban => {
            const banChannelId = process.env.DISCORD_BAN_LOG_CHANNEL_ID || '1529286560271306995';
            const channel = await ban.client.channels.fetch(banChannelId).catch(() => null);
            if (!channel?.isSendable()) return;
            let bannedBy = 'Unknown';
            let reason = 'Unspecified';

            try {
                const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
                const entry = logs.entries.first();
                if (entry?.targetId === ban.user.id) {
                    bannedBy = entry.executor ? `<@${entry.executor.id}>` : 'Unknown';
                    if (entry.reason) reason = entry.reason;
                }
            } catch {
                // ignore
            }

            const banEmbed = new EmbedBuilder()
                .setColor(0xdc2626)
                .setTitle('Member Banned')
                .setDescription(`<@${ban.user.id}> was banned from the server.`)
                .setThumbnail(ban.user.displayAvatarURL())
                .addFields(
                    { name: 'Discord Tag', value: ban.user.tag, inline: true },
                    accountCreatedField(ban.user.id),
                    { name: 'Banned By', value: bannedBy, inline: true },
                    { name: 'Ban Reason', value: reason, inline: false },
                )
                .setFooter({ text: BRAND.footer })
.setTimestamp();

            await channel.send({ embeds: [banEmbed], files: [createLogoAttachment()] }).catch(() => undefined);

            // DM the banned user with an appeal button
            await sendPunishmentDm(bot, ban.user.id, 'ban', reason, ban.guild.name).catch(() => undefined);
        });

        bot.on('messageCreate', async message => {
            // Handle ban appeal DM conversations first (DMs have no guild).
            if (await handleAppealDmMessage(message)) return;
            await handleMessageModeration(message);
        });
    }
    return bot;
}

let client = createConfiguredClient(enablePrivileged);

async function bootstrap(): Promise<void> {
    // Start the HTTP/webhook server FIRST so platform health checks (/health)
    // respond immediately. This prevents Render/Railway from treating a slow
    // or failed Discord login as a dead service (which causes restart loops
    // and free-tier spin-down).
    try {
        webhookServer = startWebhookServer(client);
    } catch (error) {
        logger.warn(`Webhook server failed to start: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

// Wrap every startup step so nothing crashes the process
    await connectDatabase().catch(error => {
        logger.warn(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    });

    try {
        configureInfractionDatabaseAdapter();
    } catch (error) {
        logger.warn(`Infraction database adapter failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    try {
        configureInfractionAuthorization(async (interaction, record) => {
            if (interaction.user.id === record.issuedById) return true;
            const authorizedUsers = (process.env.INFRACTION_AUTHORIZED_USER_IDS || '')
                .split(',').map(value => value.trim()).filter(Boolean);
            if (authorizedUsers.includes(interaction.user.id)) return true;
            const member = interaction.member;
            const memberRoleIds = member instanceof GuildMember ? [...member.roles.cache.keys()] : member?.roles || [];
            const roleIds = [
                INFRACTION_AUTHORIZED_ROLE_ID,
                process.env.BOT_PERMISSIONS_ROLE_ID,
            ].filter((roleId): roleId is string => Boolean(roleId));
            return roleIds.some(roleId => memberRoleIds.includes(roleId));
        });
    } catch (error) {
        logger.warn(`Infraction authorization config failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    const token = getDiscordBotToken();
    if (!token) {
        logger.error('TOKEN or BOT_TOKEN must be configured in environment variables.');
        return;
    }

    try {
        await client.login(token);
    } catch (error) {
        if (!enablePrivileged || !/disallowed intents/i.test(error instanceof Error ? error.message : String(error))) {
            logger.error(`Discord login failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            return;
        }
        logger.warn('Discord rejected privileged intents. Retrying with slash-command-only intents so the bot can remain online.');
        client.destroy();
        client = createConfiguredClient(false);
        try {
            await client.login(token);
        } catch (loginError) {
            logger.error(`Discord login (fallback) failed: ${loginError instanceof Error ? loginError.message : 'Unknown'}`);
            return;
        }
    }

    // Enable /punish and /punishment commands to send DMs
    setDiscordClientForDm(client);

    // Enable ban appeal DM flow and review-channel submissions
    setBanAppealClient(client);

    // Log raid-threat monitoring configuration status so you can confirm it at a glance
    logger.info(
        `[Raid Threat Monitor] ${enablePrivileged ? 'Active (ENABLE_PRIVILEGED_INTENTS=true)' : 'DISABLED (ENABLE_PRIVILEGED_INTENTS not set)'}` +
        ` | EMERGENCY_STAFF_ROLE_ID: ${process.env.EMERGENCY_STAFF_ROLE_ID || 'NOT SET (High confidence alerts will not ping)'}` +
        ` | RAID_THREAT_LOG_CHANNEL_ID: ${process.env.RAID_THREAT_LOG_CHANNEL_ID || CHANNEL_IDS.raidThreatLog}` +
        ` | Rapid join threshold: 5 joins in 10 seconds, 60s cooldown`
    );

}

async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}; shutting down.`);
    if (erlcMonitor) try { erlcMonitor.stop(); } catch { /* ignore */ }
    client.destroy();
    const activeServer = webhookServer;
    webhookServer = null;
    if (activeServer?.listening) {
        await new Promise<void>(resolve => {
            activeServer.close(error => {
                if (error) logger.warn(`Webhook server shutdown encountered an error: ${error.message}`);
                resolve();
            });
        });
    }
    await disconnectDatabase().catch(() => undefined);
    logger.info('Shutdown complete.');
}

process.once('SIGINT', () => void shutdown('SIGINT').catch(() => undefined));
process.once('SIGTERM', () => void shutdown('SIGTERM').catch(() => undefined));

// Startup retry loop — keeps trying to bootstrap so the process never stays dead
const MAX_BOOTSTRAP_RETRIES = 5;

async function runBootstrapWithRetry(attempt = 1): Promise<void> {
    try {
        await bootstrap();
        logger.info('[Bootstrap] Bot started successfully.');
    } catch (error) {
        logger.error(`[Bootstrap] Startup failed (attempt ${attempt}/${MAX_BOOTSTRAP_RETRIES}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (attempt < MAX_BOOTSTRAP_RETRIES) {
            const delay = Math.min(attempt * 15_000, 60_000);
            logger.info(`[Bootstrap] Retrying in ${delay / 1_000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            await runBootstrapWithRetry(attempt + 1);
        } else {
            logger.error('[Bootstrap] Max retries reached. The bot could not start. Please check environment configuration.');
        }
    }
}

runBootstrapWithRetry();

