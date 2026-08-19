import { ActivityType, Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { handleQuotaMessage, startMessageQuotaScheduler } from '../commands/messageQuota';
import { startActivityCheckScheduler } from '../commands/activityCheck';
import { logger } from '../utils/logger';
import { getDiscordBotToken } from '../config/env';
import { startAdvancedPaidAdScheduler } from '../commands/advancedPaidAds';
import { registerTicketAiTriage } from './ticketAiTriage';
import { registerTicketPriority } from './ticketPriority';
import { registerJoinAccountDateCorrection } from './joinAccountDateCorrection';
import { registerRaidProtection } from './raidProtection';

const MEMBER_COUNT_REFRESH_MS = 5 * 60 * 1000;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;

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
        if (memberCount == null) {
            memberCount = client.guilds.cache.get(guildId)?.members.cache.size ?? 0;
        }
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
    const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
    try {
        if (guildId) {
            const legacyGlobalCommands = await rest.get(
                Routes.applicationCommands(client.application.id),
            ) as Array<{ id: string; name: string }>;
            if (legacyGlobalCommands.length > 0) {
                await rest.put(Routes.applicationCommands(client.application.id), { body: [] });
                logger.info(`Removed ${legacyGlobalCommands.length} legacy global slash commands.`);
            }
            await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: commands });
            logger.info(`Registered ${commands.length} guild slash commands in ${guildId}: ${[...uniqueNames].join(', ')}`);
        } else {
            await rest.put(Routes.applicationCommands(client.application.id), { body: commands });
            logger.info(`Registered ${commands.length} global slash commands because no connected guild was available.`);
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

    const quotaIntentsReady = client.options.intents.has(GatewayIntentBits.GuildMessages)
        && client.options.intents.has(GatewayIntentBits.MessageContent)
        && client.options.intents.has(GatewayIntentBits.GuildMembers);
    if (quotaIntentsReady) {
        client.on('messageCreate', handleQuotaMessage);
        startMessageQuotaScheduler(client);
    } else {
        logger.error('[Quota] DISABLED: GuildMessages, MessageContent, and GuildMembers intents are required. Weekly evaluation will not run while quota tracking is disabled.');
    }

    if (memberCountPresenceTimer) {
        clearInterval(memberCountPresenceTimer);
        memberCountPresenceTimer = null;
    }
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => {
        void updateMemberCountPresence(client);
    }, MEMBER_COUNT_REFRESH_MS);
    startActivityCheckScheduler(client);
    startAdvancedPaidAdScheduler(client);
};