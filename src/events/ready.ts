import { Client, type ApplicationCommandDataResolvable } from 'discord.js';
import { commandDefinitions } from '../commands/registry';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { logger } from '../utils/logger';
import { refreshExistingTicketPanels } from '../commands/tickets';
import { autoConfigureGuild } from '../config/autoConfig';

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);
    if (!client.application) {
        logger.error('Discord application information is unavailable.');
        return;
    }

    const configuredGuildId = process.env.GUILD_ID?.trim();
    const configuredGuild = configuredGuildId ? client.guilds.cache.get(configuredGuildId) : undefined;
    const guilds = configuredGuild ? [configuredGuild] : [...client.guilds.cache.values()];
    if (configuredGuildId && !configuredGuild) {
        logger.warn(`Configured GUILD_ID ${configuredGuildId} is not connected; using the bot's connected server instead.`);
    }

    for (const guild of guilds) {
        try {
            await autoConfigureGuild(guild);
        } catch (error) {
            logger.warn(`Automatic server configuration was incomplete for ${guild.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    const uniqueNames = new Set<string>();
    const commands: ApplicationCommandDataResolvable[] = commandDefinitions.map(command => {
        if (uniqueNames.has(command.data.name)) throw new Error(`Duplicate slash command definition: ${command.data.name}`);
        uniqueNames.add(command.data.name);
        return command.data.toJSON() as ApplicationCommandDataResolvable;
    });

    if (guilds.length > 0) {
        let successes = 0;
        for (const guild of guilds) {
            try {
                await guild.commands.set(commands);
                successes += 1;
                logger.info(`Registered ${commands.length} slash commands in ${guild.name}.`);
            } catch (error) {
                logger.error(`Could not register slash commands in ${guild.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (successes === 0) {
            logger.warn('No connected server accepted slash-command registration. Reinvite the bot with the bot and applications.commands scopes.');
        }
    } else {
        try {
            await client.application.commands.set(commands);
            logger.info(`Registered ${commands.length} global slash commands.`);
        } catch (error) {
            logger.error(`Could not register global slash commands: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
