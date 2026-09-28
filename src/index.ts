import 'dotenv/config';
import {
    ActionRowBuilder,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    GuildMember,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';
import type { Server } from 'http';
import { interactionCreate } from './handlers/interactionCreate';
import { onReady } from './events/ready';
import { startWebhookServer } from './webhook/server';
import { connectDatabase, disconnectDatabase } from './database/connection';
import { configureInfractionDatabaseAdapter } from './database/infractionAdapter';
import { handleMessageModeration } from './events/messageModeration';
import { startErlcMonitor, type ErlcMonitor } from './monitors/erlcMonitor';
import { MongoErlcMonitorStateStore } from './database/erlcStateStore';
import { BRAND, CHANNEL_IDS } from './config/constants';
import { createLogoAttachment } from './utils/embeds';
import { logger } from './utils/logger';
import { configureInfractionAuthorization } from './commands/staffManagement';
import { cleanupStaleTicketReservations } from './services/ticketRepository';
import { getBloxlinkApiKey, getDiscordBotToken } from './config/env';
import { setDiscordClientForDm } from './commands/punishment';
import { handlePrefixCommand } from './commands/prefix';
import { embedsToV2 } from './utils/componentsV2';

// Crash-proof error handling — prevents Node.js from exiting on unhandled rejections (Node 24+ default)
process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`[Process] Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (error: Error) => {
    logger.error(`[Process] Uncaught exception: ${error.message}`);
});

// Keep-alive timer to prevent event loop from emptying if all timers/promises resolve
setInterval(() => {}, 60_000).unref();

const enablePrivileged = (process.env.ENABLE_PRIVILEGED_INTENTS || 'true').toLowerCase() !== 'false';
let activePrivilegedIntents = enablePrivileged;
let erlcMonitor: ErlcMonitor | null = null;
let webhookServer: Server | null = null;
const rapidJoinStates = new Map<string, { joins: number[]; lastAlertAt: number }>();

function createConfiguredClient(privilegedIntents: boolean): Client {
    const intents = [GatewayIntentBits.Guilds];
    if (privilegedIntents) {
        intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    } else {
            logger.info('Running in slash-command-only mode; member events and message moderation are disabled.');
    }
    const bot = new Client({ intents });
    bot.on('interactionCreate', interactionCreate);
    bot.on('error', error => logger.error(`Discord client error: ${error.message}`));

    bot.once(Events.ClientReady, async () => {
        await onReady(bot);
        if (!getBloxlinkApiKey()) {
            logger.info('Bloxlink integration is disabled because BLOXLINK_API_KEY is not configured.');
        }
        if (!process.env.BOT_PERMISSIONS_ROLE_ID) {
            logger.info('No bot-permissions role was found; administrative setup commands remain administrator-only.');
        }
        if (!process.env.EMERGENCY_STAFF_ROLE_ID) {
            logger.info('No emergency staff role was found; raid alerts will be logged without a role ping.');
        }
        if (!process.env.ERLC_SERVER_KEY && !process.env.ERLC_API) {
            logger.info('ER:LC monitoring is disabled because ERLC_API is not configured; Quick Join still works.');
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
        bot.on('guildMemberAdd', async member => {
            const joinChannelId = process.env.JOIN_LOG_CHANNEL_ID || '';
            const joinChannel = await member.client.channels.fetch(joinChannelId).catch(() => null);
            if (joinChannel?.isSendable()) {
                const dashboardUrl = process.env.DASHBOARD_URL?.trim()
                    || `https://discord.com/channels/${member.guild.id}/${joinChannel.id}`;
                const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId('welcome:member-count')
                        .setLabel(member.guild.memberCount.toLocaleString())
                        .setEmoji('👤')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setLabel('Dashboard')
                        .setStyle(ButtonStyle.Link)
                        .setURL(dashboardUrl),
                );
                await joinChannel.send({
                    content: `👋 Welcome ${member} to **${member.guild.name}**! Please make yourself feel at home!`,
                    components: [controls],
                    allowedMentions: { users: [member.id], parse: [] },
                }).catch(() => undefined);
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
            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('Rapid Join Alert')
                .setDescription(`${emergencyRoleId ? `<@&${emergencyRoleId}>\n\n` : ''}A burst of new members may require staff review. No automatic moderation action was taken.`)
                .setThumbnail(BRAND.logoUrl)
                .addFields(
                    { name: 'Joins Detected', value: `${state.joins.length} within 10 seconds`, inline: true },
                    { name: 'Confidence', value: 'High', inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();
            await raidChannel.send({
                components: embedsToV2([embed]),
                files: [createLogoAttachment()],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: emergencyRoleId ? { roles: [emergencyRoleId] } : { parse: [] },
            }).catch(() => undefined);
        });

        bot.on('guildMemberRemove', async member => {
            const leaveChannelId = process.env.LEAVE_LOG_CHANNEL_ID || '';
            const leaveChannel = await member.client.channels.fetch(leaveChannelId).catch(() => null);
            if (leaveChannel?.isSendable()) await leaveChannel.send(`${member.user.tag} left the server.`).catch(() => undefined);

            try {
                const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
                const entry = logs.entries.first();
                if (entry?.targetId !== member.id) return;
                const kickChannelId = process.env.DISCORD_KICK_LOG_CHANNEL_ID || '';
                const kickChannel = await member.client.channels.fetch(kickChannelId).catch(() => null);
                if (kickChannel?.isSendable()) {
                    await kickChannel.send(`${member.user.tag} was kicked by <@${entry.executor?.id}>.`).catch(() => undefined);
                }
            } catch {
                // Missing audit-log permissions should not interrupt other member events.
            }
        });

        bot.on('guildBanAdd', async ban => {
            const banChannelId = process.env.DISCORD_BAN_LOG_CHANNEL_ID || '';
            const channel = await ban.client.channels.fetch(banChannelId).catch(() => null);
            if (channel?.isSendable()) await channel.send(`${ban.user.tag} was banned.`).catch(() => undefined);
        });

        bot.on('messageCreate', async message => {
            const handled = await handlePrefixCommand(message);
            if (!handled) await handleMessageModeration(message);
        });
    }
    return bot;
}

let client = createConfiguredClient(enablePrivileged);

async function bootstrap(): Promise<void> {
    // Wrap every startup step so nothing crashes the process
    await connectDatabase().catch(error => {
        logger.warn(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    });
    await cleanupStaleTicketReservations().catch(error => {
        logger.warn(`Startup ticket-reservation cleanup was unavailable: ${error instanceof Error ? error.name : 'UnknownError'}`);
    });

    try {
        configureInfractionDatabaseAdapter();
    } catch (error) {
        logger.warn(`Infraction database adapter failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    try {
        configureInfractionAuthorization(async (interaction, record) => {
            if (interaction.user.id === record.issuedById) return true;
            if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
                || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
                || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads)) return true;
            const authorizedUsers = (process.env.INFRACTION_AUTHORIZED_USER_IDS || '')
                .split(',').map(value => value.trim()).filter(Boolean);
            if (authorizedUsers.includes(interaction.user.id)) return true;
            const member = interaction.member;
            const memberRoleIds = member instanceof GuildMember ? [...member.roles.cache.keys()] : member?.roles || [];
            const roleIds = [
                process.env.BOT_PERMISSIONS_ROLE_ID,
                process.env.ADMIN_ROLE_ID,
                process.env.HIGH_RANK_ROLE_ID,
                process.env.MANAGEMENT_ROLE_ID,
                ...(process.env.INFRACTION_AUTHORIZED_ROLE_IDS || '').split(',').map(value => value.trim()),
            ].filter((roleId): roleId is string => Boolean(roleId));
            return roleIds.some(roleId => memberRoleIds.includes(roleId));
        });
    } catch (error) {
        logger.warn(`Infraction authorization config failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    const token = getDiscordBotToken();
    if (!token) {
        logger.error('BOT_TOKEN must be configured in environment variables.');
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
        activePrivilegedIntents = false;
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

    // Log raid-threat monitoring configuration status so you can confirm it at a glance
    logger.info(
        `[Raid Threat Monitor] ${activePrivilegedIntents ? 'Active' : 'Disabled (privileged intents unavailable)'}` +
        ` | EMERGENCY_STAFF_ROLE_ID: ${process.env.EMERGENCY_STAFF_ROLE_ID || 'NOT SET (High confidence alerts will not ping)'}` +
        ` | RAID_THREAT_LOG_CHANNEL_ID: ${process.env.RAID_THREAT_LOG_CHANNEL_ID || CHANNEL_IDS.raidThreatLog}` +
        ` | Rapid join threshold: 5 joins in 10 seconds, 60s cooldown`
    );

    // Start webhook server — if port is taken, just log and continue
    try {
        webhookServer = startWebhookServer(client);
    } catch (error) {
        logger.warn(`Webhook server failed to start: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
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

// Bootstrap and never let errors exit the process
bootstrap().catch(error => {
    logger.error(`Startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
});
