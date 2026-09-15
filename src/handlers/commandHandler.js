const logger = require('../utils/logger');

function loadCommands(client) {
    const commandsPath = path.join(__dirname, '..', 'commands', 'prefix');
    if (!fs.existsSync(commandsPath)) return logger.warn('Prefix commands directory not found.');
    
    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        client.prefixCommands.set(command.name, command);
        if (command.aliases) {
            for (const alias of command.aliases) {
                client.prefixCommands.set(alias, command);
            }
        }
    }
    logger.info(`Loaded ${client.prefixCommands.size} prefix commands`);
}

module.exports = { loadCommands };
