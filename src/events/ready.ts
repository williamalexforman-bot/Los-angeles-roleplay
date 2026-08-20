import { ActivityType, Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { handleQuotaMessage, startMessageQuotaScheduler } from '../commands/messageQuota';
import { startActivityCheckScheduler } from '../commands/activityCheck';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';
import { getDiscordBotToken } from '../config/env';
import { startAdvancedPaidAdScheduler } from '../commands/advancedPaidAds';
import { registerTicketAiTriage } from './ticketAiTriage';
import { registerTicketPriority } from './ticketPriority';
import { registerJoinAccountDateCorrection } from './joinAccountDateCorrection';
import { registerRaidProtection } from './raidProtection';

const MEMBER_COUNT_REFRESH_MS = 5 * 60 * 1000;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;
let quotaMessageListenerRegistered = false;

async function updateMemberCountPresence(client: Client): Promise<void> {
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) {
            logger.warn('[Presence] Could not update member count because no Discord guild is available.');
            return;
        }
        let memberCount: number | null | undefined;
        try {
            const guild = await client.guilds.fetch({ guild: guildId, force: true });
            memberCount = guild.memberCount;
        } catch {
            memberCount = client.guilds.cache.get(guildId)?.memberCount;
        }
        if (memberCount == null) memberCount = client.guilds.cache.get(guildId)?.members.cache.size ?? 0;
        await client.user?.setActivity(`${memberCount} members`, { type: ActivityType.Watching });
        logger.info(`[Presence] Status updated: Watching ${memberCount} members.`);
    } catch (error) {
        logger.warn(`[Presence] Member-count presence update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);
    const token = client.token || getDiscordBotToken();
    if (!token || !client.application) {
        logger.error('Bot token or application information is missing.');
        return;
    }

    registerTicketAiTriage(client);
    registerTicketPriority(client);
    registerJoinAccountDateCorrection(client);
    registerRaidProtection(client);

    const uniqueNames = new Set<string>();
    const commands = commandDefinitions.map(command => {
        if (uniqueNames.has(command.data.name)) throw new Error(`Duplicate slash command definition: ${command.data.name}`);
        uniqueNames.add(command.data.name);
        return command.data.toJSON();
    });

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        const legacyGlobalCommands = await rest.get(Routes.applicationCommands(client.application.id)) as Array<{ id: string; name: string }>;
        if (legacyGlobalCommands.length > 0) {
            await rest.put(Routes.applicationCommands(client.application.id), { body: [] });
            logger.info(`Removed ${legacyGlobalCommands.length} legacy global slash commands.`);
        }

        // Always register to every guild the running bot is actually connected to.
        // A stale GUILD_ID must never make commands disappear from the live server.
        const guildIds = new Set<string>(client.guilds.cache.keys());
        const configuredGuildId = process.env.GUILD_ID?.trim();
        if (configuredGuildId) guildIds.add(configuredGuildId);

        if (guildIds.size === 0) {
            await rest.put(Routes.applicationCommands(client.application.id), { body: commands });
            logger.info(`Registered ${commands.length} global slash commands because no connected guild was available.`);
        } else {
            for (const guildId of guildIds) {
                try {
                    const registered = await rest.put(
                        Routes.applicationGuildCommands(client.application.id, guildId),
                        { body: commands },
                    ) as Array<{ id: string; name: string }>;
                    const registeredNames = registered.map(command => command.name);
                    logger.info(`Registered ${registered.length} guild slash commands in ${guildId}: ${registeredNames.join(', ')}`);
                    for (const requiredName of ['activity-check', 'activitycheck', 'view-activity-check', 'end-activity-check', 'stopactivitycheck', 'void-activity-check', 'view-my-quota']) {
                        if (!registeredNames.includes(requiredName)) logger.error(`[SlashCommands] Discord did not return required command ${requiredName} for guild ${guildId}.`);
                    }
                } catch (error) {
                    logger.error(`[SlashCommands] Could not register commands in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
    } catch (error) {
        const details = error instanceof Error ? (error.stack || error.message) : String(error);
        logger.error(`Failed to register slash commands: ${details}`);
    }

    try {
        await loadProhibitedWordOverrides([...client.guilds.cache.keys()]);
    } catch (error) {
        logger.warn(`Prohibited-word overrides could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Quota is database-backed. Finish the initial Mongo connection before
    // enabling it so /view-my-quota and message counting cannot race startup.
    const databaseReady = await connectDatabase().catch(() => false);
    const quotaIntentsReady = client.options.intents.has(GatewayIntentBits.GuildMessages)
        && client.options.intents.has(GatewayIntentBits.MessageContent)
        && client.options.intents.has(GatewayIntentBits.GuildMembers);

    if (quotaIntentsReady) {
        if (!quotaMessageListenerRegistered) {
            client.on('messageCreate', handleQuotaMessage);
            quotaMessageListenerRegistered = true;
        }
        startMessageQuotaScheduler(client);
        logger.info(`[Quota] Startup complete. Database: ${databaseReady ? 'connected' : 'retrying in fallback mode'}.`);
    } else {
        logger.error('[Quota] DISABLED: GuildMessages, MessageContent, and GuildMembers intents are required. Weekly evaluation will not run while quota tracking is disabled.');
    }

    if (memberCountPresenceTimer) {
        clearInterval(memberCountPresenceTimer);
        memberCountPresenceTimer = null;
    }
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => void updateMemberCountPresence(client), MEMBER_COUNT_REFRESH_MS);
    startActivityCheckScheduler(client);
    startAdvancedPaidAdScheduler(client);
};