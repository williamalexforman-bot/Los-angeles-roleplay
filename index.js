require('dotenv').config();

const http = require('node:http');
const { Client, GatewayIntentBits } = require('discord.js');
const { configCommand } = require('./src/commands/config');
const { handleInteraction } = require('./src/interactions');

const token = process.env.BOT_TOKEN;
const port = Number(process.env.PORT || 10000);

const healthServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('CSRP bot is running.');
});

healthServer.listen(port, '0.0.0.0', () => {
  console.log(`Health server listening on 0.0.0.0:${port}`);
});

healthServer.on('error', (error) => {
  console.error('Health server failed:', error);
  process.exit(1);
});

if (!token) {
  console.warn('BOT_TOKEN is not set. The health server is running, but Discord commands are offline.');
} else {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    try {
      await client.application.commands.set([]);
      await Promise.all(
        client.guilds.cache.map((guild) => guild.commands.set([configCommand.toJSON()])),
      );
      console.log(`Ready as ${client.user.tag}. Registered /config.`);
    } catch (error) {
      console.error('Failed to register Discord commands:', error);
    }
  });

  client.on('interactionCreate', handleInteraction);
  client.login(token).catch((error) => console.error('Failed to log in:', error));
}
