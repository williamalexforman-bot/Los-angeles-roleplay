import { Client, REST, Routes } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { logger } from '../utils/logger';
import { getDiscordBotToken } from '../config/env';
import { refreshExistingTicketPanels } from '../commands/tickets';

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
        const refreshedPanels = await refreshExistingTicketPanels(client);
        if (refreshedPanels > 0) {
            logger.info(`Updated ${refreshedPanels} existing ticket panel${refreshedPanels === 1 ? '' : 's'} to the dropdown layout.`);
        }
    } catch (error) {
        logger.warn(`Existing ticket panels could not be refreshed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
        await loadProhibitedWordOverrides([...client.guilds.cache.keys()]);
    } catch (error) {
        logger.warn(`Prohibited-word overrides could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
