const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const logger = require('../utils/logger');

function loadSlashCommands(client) {
    const commandsPath = path.join(__dirname, '..', 'commands', 'slash');
    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if (!command?.data) {
            logger.warn(`Skipping ${file}: missing command data`);
            continue;
        }
        client.slashCommands.set(command.data.name, command);
    }
    logger.info(`Loaded ${client.slashCommands.size} slash commands`);
}

async function registerSlashCommands(client) {
    const commands = [];
    client.slashCommands.forEach(cmd => commands.push(cmd.data.toJSON()));

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        logger.success('Registered slash commands with Discord');
    } catch (e) {
        logger.error('Failed to register slash commands:', e);
    }
}

module.exports = { loadSlashCommands, registerSlashCommands };
