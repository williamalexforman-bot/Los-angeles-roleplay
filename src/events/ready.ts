import { ActivityType, Client, REST, Routes } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
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
const DISCORD_CHAT_INPUT_COMMAND_LIMIT = 100;
const REQUIRED_COMMAND_NAMES = [
    'activity-check',
    'view-activity-check',
    'end-activity-check',
    'void-activity-check',
] as const;
const OPTIONAL_ACTIVITY_ALIASES = ['activitycheck', 'stopactivitycheck'] as const;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;

type CommandJson = ReturnType<(typeof commandDefinitions)[number]['data']['toJSON']>;
type RegisteredCommand = { id: string; name: string };

async function verifyAndRepairRequiredGuildCommands(
    rest: REST,
    applicationId: string,
    guildId: string,
    commandJsonByName: Map<string, CommandJson>,
): Promise<void> {
    let current = await rest.get(
        Routes.applicationGuildCommands(applicationId, guildId),
    ) as RegisteredCommand[];
    let currentNames = new Set(current.map(command => command.name));

    for (const requiredName of REQUIRED_COMMAND_NAMES) {
        if (currentNames.has(requiredName)) continue;
        const body = commandJsonByName.get(requiredName);
        if (!body) {
            logger.error(`[SlashCommands] Cannot repair ${requiredName}: local command definition is missing.`);
            continue;
        }

        logger.warn(`[SlashCommands] ${requiredName} is missing from Discord guild ${guildId}; creating it directly now.`);
        try {
            await rest.post(
                Routes.applicationGuildCommands(applicationId, guildId),
                { body },
            );
        } catch (error) {
            logger.error(`[SlashCommands] Direct creation failed for ${requiredName} in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    current = await rest.get(
        Routes.applicationGuildCommands(applicationId, guildId),
    ) as RegisteredCommand[];
    currentNames = new Set(current.map(command => command.name));

    for (const requiredName of REQUIRED_COMMAND_NAMES) {
        if (currentNames.has(requiredName)) {
            logger.info(`[SlashCommands] VERIFIED /${requiredName} in guild ${guildId}.`);
        } else {
            logger.error(`[SlashCommands] CRITICAL: /${requiredName} is still missing from Discord guild ${guildId} after repair.`);
        }
    }
}

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
    const commandEntries = commandDefinitions.map((command, index) => {
        if (uniqueNames.has(command.data.name)) throw new Error(`Duplicate slash command definition: ${command.data.name}`);
        uniqueNames.add(command.data.name);
        return { name: command.data.name, json: command.data.toJSON(), index };
    });
    const commandJsonByName = new Map(commandEntries.map(entry => [entry.name, entry.json]));

    const protectedNames = new Set<string>([...REQUIRED_COMMAND_NAMES, ...OPTIONAL_ACTIVITY_ALIASES]);
    const prioritizedEntries = [...commandEntries].sort((a, b) => {
        const aProtected = protectedNames.has(a.name) ? 0 : 1;
        const bProtected = protectedNames.has(b.name) ? 0 : 1;
        return aProtected - bProtected || a.index - b.index;
    });
    const selectedEntries = prioritizedEntries.slice(0, DISCORD_CHAT_INPUT_COMMAND_LIMIT);
    const commands = selectedEntries.map(entry => entry.json);
    const selectedNames = new Set(selectedEntries.map(entry => entry.name));
    const skippedNames = prioritizedEntries.slice(DISCORD_CHAT_INPUT_COMMAND_LIMIT).map(entry => entry.name);

    logger.info(`[SlashCommands] Prepared ${commands.length}/${commandEntries.length} chat-input commands for Discord registration.`);
    if (skippedNames.length) {
        logger.warn(`[SlashCommands] Discord allows at most ${DISCORD_CHAT_INPUT_COMMAND_LIMIT} chat-input commands. Skipped lower-priority commands: ${skippedNames.join(', ')}`);
    }
    for (const requiredName of REQUIRED_COMMAND_NAMES) {
        if (!selectedNames.has(requiredName)) logger.error(`[SlashCommands] Required command ${requiredName} is missing from the local registration payload.`);
    }

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        const legacyGlobalCommands = await rest.get(Routes.applicationCommands(client.application.id)) as RegisteredCommand[];
        if (legacyGlobalCommands.length > 0) {
            await rest.put(Routes.applicationCommands(client.application.id), { body: [] });
            logger.info(`Removed ${legacyGlobalCommands.length} legacy global slash commands.`);
        }

        const guildIds = new Set<string>(client.guilds.cache.keys());
        const configuredGuildId = process.env.GUILD_ID?.trim();
        if (configuredGuildId) guildIds.add(configuredGuildId);

        if (guildIds.size === 0) {
            const registered = await rest.put(
                Routes.applicationCommands(client.application.id),
                { body: commands },
            ) as RegisteredCommand[];
            const registeredNames = registered.map(command => command.name);
            logger.info(`Registered ${registered.length} global slash commands because no connected guild was available.`);
            for (const requiredName of REQUIRED_COMMAND_NAMES) {
                if (!registeredNames.includes(requiredName)) logger.error(`[SlashCommands] Discord did not return required global command ${requiredName}.`);
            }
        } else {
            for (const guildId of guildIds) {
                try {
                    const registered = await rest.put(
                        Routes.applicationGuildCommands(client.application.id, guildId),
                        { body: commands },
                    ) as RegisteredCommand[];
                    const registeredNames = registered.map(command => command.name);
                    logger.info(`Registered ${registered.length} guild slash commands in ${guildId}: ${registeredNames.join(', ')}`);
                    for (const requiredName of REQUIRED_COMMAND_NAMES) {
                        if (!registeredNames.includes(requiredName)) logger.error(`[SlashCommands] Discord did not return required command ${requiredName} for guild ${guildId}.`);
                    }
                } catch (error) {
                    logger.error(`[SlashCommands] Bulk registration failed in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
                }

                try {
                    await verifyAndRepairRequiredGuildCommands(
                        rest,
                        client.application.id,
                        guildId,
                        commandJsonByName,
                    );
                } catch (error) {
                    logger.error(`[SlashCommands] Verification/repair failed in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
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

    await connectDatabase().catch(() => false);
    logger.info('[Quota] Text/message quota tracking is disabled.');

    if (memberCountPresenceTimer) {
        clearInterval(memberCountPresenceTimer);
        memberCountPresenceTimer = null;
    }
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => void updateMemberCountPresence(client), MEMBER_COUNT_REFRESH_MS);
    startActivityCheckScheduler(client);
    startAdvancedPaidAdScheduler(client);
};