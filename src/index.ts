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
import { handleTicketAssistantMessage } from './commands/tickets';
import { startErlcMonitor, type ErlcMonitor } from './monitors/erlcMonitor';
import { MongoErlcMonitorStateStore } from './database/erlcStateStore';
import { BRAND, CHANNEL_IDS } from './config/constants';
import { createLogoAttachment } from './utils/embeds';
import { logger } from './utils/logger';
import { configureInfractionAuthorization } from './commands/staffManagement';
import { cleanupStaleTicketReservations } from './services/ticketRepository';
import { getBloxlinkApiKey, getDiscordBotToken, getOpenAiApiKey, getOpenAiModel } from './config/env';

const enablePrivileged = (process.env.ENABLE_PRIVILEGED_INTENTS || 'false').toLowerCase() === 'true';
let erlcMonitor: ErlcMonitor | null = null;
let webhookServer: Server | null = null;
const rapidJoinStates = new Map<string, { joins: number[]; lastAlertAt: number }>();

function createConfiguredClient(privilegedIntents: boolean): Client {
    const intents = [GatewayIntentBits.Guilds];
    if (privilegedIntents) {
        intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    } else {
        logger.warn('Running without privileged intents; message moderation, AI ticket replies, and member events are disabled until enabled in the Discord Developer Portal.');
    }
    const bot = new Client({ intents });
    bot.on('interactionCreate', interactionCreate);
    bot.on('error', error => logger.error(`Discord client error: ${error.message}`));

    bot.once(Events.ClientReady, async () => {
        await onReady(bot);
        if (!getBloxlinkApiKey()) {
            logger.warn('BLOXLINK_API_KEY is missing or still a placeholder. Set it in the runtime environment (the project .env file for local hosting), then restart the bot.');
        }
        if (!getOpenAiApiKey()) {
            logger.warn('OPENAI_API_KEY is missing or still a placeholder. Set it in the runtime environment (the project .env file for local hosting), then restart the bot.');
        } else {
            logger.info(`Automated ticket assistant configured with model ${getOpenAiModel()}.`);
        }
        if (!process.env.BOT_PERMISSIONS_ROLE_ID) {
            logger.warn('BOT_PERMISSIONS_ROLE_ID is not configured; /ticket-panel remains administrator-only.');
        }
        if (!process.env.EMERGENCY_STAFF_ROLE_ID) {
            logger.warn('EMERGENCY_STAFF_ROLE_ID is not configured; High-confidence raid alerts will log without a role ping.');
        }
        if (!process.env.ERLC_SERVER_KEY) {
            logger.warn('ERLC_SERVER_KEY is not configured; ER:LC monitoring is disabled.');
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
            const joinChannelId = process.env.JOIN_LOG_CHANNEL_ID || '1529283685168447698';
            const joinChannel = await member.client.channels.fetch(joinChannelId).catch(() => null);
            if (joinChannel?.isSendable()) await joinChannel.send(`${member.user.tag} joined the server.`).catch(() => undefined);

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
                embeds: [embed],
                files: [createLogoAttachment()],
                allowedMentions: emergencyRoleId ? { roles: [emergencyRoleId] } : { parse: [] },
            }).catch(() => undefined);
        });

        bot.on('guildMemberRemove', async member => {
            const leaveChannelId = process.env.LEAVE_LOG_CHANNEL_ID || '1529283711466606815';
            const leaveChannel = await member.client.channels.fetch(leaveChannelId).catch(() => null);
            if (leaveChannel?.isSendable()) await leaveChannel.send(`${member.user.tag} left the server.`).catch(() => undefined);

            try {
                const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
                const entry = logs.entries.first();
                if (entry?.targetId !== member.id) return;
                const kickChannelId = process.env.DISCORD_KICK_LOG_CHANNEL_ID || '1529286532706467922';
                const kickChannel = await member.client.channels.fetch(kickChannelId).catch(() => null);
                if (kickChannel?.isSendable()) {
                    await kickChannel.send(`${member.user.tag} was kicked by <@${entry.executor?.id}>.`).catch(() => undefined);
                }
            } catch {
                // Missing audit-log permissions should not interrupt other member events.
            }
        });

        bot.on('guildBanAdd', async ban => {
            const banChannelId = process.env.DISCORD_BAN_LOG_CHANNEL_ID || '1529286560271306995';
            const channel = await ban.client.channels.fetch(banChannelId).catch(() => null);
            if (channel?.isSendable()) await channel.send(`${ban.user.tag} was banned.`).catch(() => undefined);
        });

        bot.on('messageCreate', async message => {
            await Promise.allSettled([
                handleMessageModeration(message),
                handleTicketAssistantMessage(message),
            ]);
        });
    }
    return bot;
}

let client = createConfiguredClient(enablePrivileged);

async function bootstrap(): Promise<void> {
    await connectDatabase();
    await cleanupStaleTicketReservations().catch(error => {
        logger.warn(`Startup ticket-reservation cleanup was unavailable: ${error instanceof Error ? error.name : 'UnknownError'}`);
    });
    configureInfractionDatabaseAdapter();
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
    const token = getDiscordBotToken();
    if (!token) throw new Error('TOKEN or BOT_TOKEN must be configured.');
    try {
        await client.login(token);
    } catch (error) {
        if (!enablePrivileged || !/disallowed intents/i.test(error instanceof Error ? error.message : String(error))) throw error;
        logger.warn('Discord rejected privileged intents. Retrying with slash-command-only intents so the bot can remain online.');
        client.destroy();
        client = createConfiguredClient(false);
        await client.login(token);
    }
    webhookServer = startWebhookServer(client);
}

async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}; shutting down.`);
    erlcMonitor?.stop();
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
    await disconnectDatabase();
    logger.info('Shutdown complete.');
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void bootstrap().catch(error => {
    logger.error(`Startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exitCode = 1;
});
