import { REST, Routes, type Client } from 'discord.js';
import { activityCheckCommands } from '../commands/activityCheck';
import { getDiscordBotToken } from '../config/env';
import { logger } from '../utils/logger';

const TARGET_COMMAND = 'activity-check';
const PROTECTED_COMMANDS = new Set([
    'activity-check',
    'view-activity-check',
    'end-activity-check',
    'void-activity-check',
    'view-my-quota',
    'view-user-quota',
    'end-weekly-quota-early',
    'extend-weeks-quota',
    'close',
    'claim',
    'open',
]);

type RegisteredCommand = { id: string; name: string };

export async function forceRepairActivityCheckCommand(client: Client): Promise<void> {
    if (!client.application) {
        logger.error('[ActivityCheckRepair] Discord application is unavailable.');
        return;
    }

    const token = client.token || getDiscordBotToken();
    if (!token) {
        logger.error('[ActivityCheckRepair] Bot token is unavailable.');
        return;
    }

    const definition = activityCheckCommands.find(command => command.data.name === TARGET_COMMAND);
    if (!definition) {
        logger.error('[ActivityCheckRepair] Local /activity-check definition is missing.');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(token);
    const guildIds = new Set(client.guilds.cache.keys());
    const configuredGuildId = process.env.GUILD_ID?.trim();
    if (configuredGuildId) guildIds.add(configuredGuildId);

    for (const guildId of guildIds) {
        try {
            let live = await rest.get(
                Routes.applicationGuildCommands(client.application.id, guildId),
            ) as RegisteredCommand[];

            if (live.some(command => command.name === TARGET_COMMAND)) {
                logger.info(`[ActivityCheckRepair] VERIFIED /${TARGET_COMMAND} already exists in guild ${guildId}.`);
                continue;
            }

            logger.warn(`[ActivityCheckRepair] /${TARGET_COMMAND} is missing in guild ${guildId}; forcing direct registration.`);

            if (live.length >= 100) {
                const removable = [...live].reverse().find(command => !PROTECTED_COMMANDS.has(command.name));
                if (!removable) {
                    logger.error(`[ActivityCheckRepair] Guild ${guildId} has 100 commands and no safe command can be removed.`);
                    continue;
                }

                await rest.delete(
                    Routes.applicationGuildCommand(client.application.id, guildId, removable.id),
                );
                logger.warn(`[ActivityCheckRepair] Removed lower-priority /${removable.name} to free a Discord command slot.`);
            }

            await rest.post(
                Routes.applicationGuildCommands(client.application.id, guildId),
                { body: definition.data.toJSON() },
            );

            live = await rest.get(
                Routes.applicationGuildCommands(client.application.id, guildId),
            ) as RegisteredCommand[];

            if (live.some(command => command.name === TARGET_COMMAND)) {
                logger.info(`[ActivityCheckRepair] SUCCESS: /${TARGET_COMMAND} is now registered in guild ${guildId}.`);
            } else {
                logger.error(`[ActivityCheckRepair] CRITICAL: Discord still did not expose /${TARGET_COMMAND} in guild ${guildId}.`);
            }
        } catch (error) {
            logger.error(`[ActivityCheckRepair] Failed in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
