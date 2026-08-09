import { ActivityType, Client, REST, Routes } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { logger } from '../utils/logger';
import { getDiscordBotToken } from '../config/env';

// Custom status refresh — updates "Watching [member count] members" every 5 minutes.
const MEMBER_COUNT_REFRESH_MS = 5 * 60 * 1000;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sets the bot's presence to "Watching [member count] members". Prefers a fresh
 * guild fetch so the count refreshes on the interval even without the Server
 * Members Intent; falls back to the cached member count so the status never
 * breaks. Errors are logged and never thrown.
 */
async function updateMemberCountPresence(client: Client): Promise<void> {
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) {
            logger.warn('[Presence] Could not update member count because no Discord guild is available.');
            return;
        }
        let memberCount: number | null | undefined;
        try {
            // Force a fresh fetch from the API so the member count is accurate
            // every interval even without the Server Members Intent.
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
    // Prefer the token that actually authenticated this client. The environment
    // resolver is retained for mocks and older discord.js-compatible clients.
    const token = client.token || getDiscordBotToken();
    if (!token || !client.application) {
        logger.error('Bot token or application information is missing.');
        return;
    }

    const uniqueNames = new Set<string>();
    const commands = commandDefinitions.map(command => {
        if (uniqueNames.has(command.data.name)) throw new Error(`Duplicate slash command definition: ${command.data.name}`);
        uniqueNames.add(command.data.name);
        return command.data.toJSON();
    });

    const rest = new REST({ version: '10' }).setToken(token);
    const guildId = process.env.GUILD_ID;
    try {
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: commands });
            logger.info(`Registered ${commands.length} guild slash commands.`);
        } else {
            await rest.put(Routes.applicationCommands(client.application.id), { body: commands });
            logger.info(`Registered ${commands.length} global slash commands.`);
        }
    } catch (error) {
        logger.error(`Failed to register slash commands: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

try {
        await loadProhibitedWordOverrides([...client.guilds.cache.keys()]);
    } catch (error) {
        logger.warn(`Prohibited-word overrides could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Refresh the "Watching [member count] members" status immediately, then
    // every 5 minutes. Clears any prior timer so reconnects never stack intervals.
    if (memberCountPresenceTimer) {
        clearInterval(memberCountPresenceTimer);
        memberCountPresenceTimer = null;
    }
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => {
        void updateMemberCountPresence(client);
    }, MEMBER_COUNT_REFRESH_MS);
};
