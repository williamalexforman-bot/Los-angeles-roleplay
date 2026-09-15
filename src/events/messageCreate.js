const { getSetting } = require('../utils/database');
const { checkRateLimit } = require('../utils/security');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message, client) {
        if (message.author.bot) return;

        const prefix = getSetting('PREFIX', process.env.PREFIX || '!');
        if (!message.content.startsWith(prefix)) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = client.prefixCommands.get(commandName);
        if (!command) return;

        // Rate Limit Check
        const rateLimit = checkRateLimit(message.author.id, commandName);
        if (rateLimit.limited) {
            return message.reply(`Slow down! You can use this again in **${rateLimit.remaining}s**.`).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 5000);
            });
        }

        try {
            await command.execute(message, args, client);
        } catch (error) {
            logger.error(`Error executing prefix command ${commandName}:`, error);
            message.reply('An error occurred while executing that command.');
        }
    }
};
