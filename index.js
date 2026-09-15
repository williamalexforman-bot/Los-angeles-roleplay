require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { loadCommands } = require('./src/handlers/commandHandler');
const { loadSlashCommands, registerSlashCommands } = require('./src/handlers/slashHandler');
const { loadEvents } = require('./src/handlers/eventHandler');
const { initDatabase } = require('./src/utils/database');
const logger = require('./src/utils/logger');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

client.prefixCommands = new Collection();
client.slashCommands = new Collection();
client.giveaways = new Collection();
client.ssuVotes = new Collection();

(async () => {
    await initDatabase();
    loadCommands(client);
    loadSlashCommands(client);
    loadEvents(client);
    await client.login(process.env.BOT_TOKEN);
    await registerSlashCommands(client);
})();
