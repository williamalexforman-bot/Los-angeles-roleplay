require('dotenv').config();

const http = require('node:http');
const { Client, GatewayIntentBits } = require('discord.js');

const token = process.env.BOT_TOKEN;
const port = Number(process.env.PORT || 10000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Render requires web services to listen on PORT. This endpoint only confirms
// that the empty bot process is running; it does not add any bot features.
const healthServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('CSRP clean bot is running.');
});

healthServer.listen(port, '0.0.0.0', () => {
  console.log(`Health server listening on 0.0.0.0:${port}`);
});

healthServer.on('error', (error) => {
  console.error('Health server failed:', error);
  process.exit(1);
});

client.once('ready', async () => {
  try {
    // Remove any global commands left over from older versions.
    await client.application.commands.set([]);

    // Remove any server-specific commands left over from older versions.
    await Promise.all(
      client.guilds.cache.map((guild) => guild.commands.set([])),
    );

    console.log(`Ready as ${client.user.tag}. All commands have been removed.`);
  } catch (error) {
    console.error('The bot logged in, but command cleanup failed:', error);
  }
});

if (token) {
  client.login(token).catch((error) => {
    console.error('Failed to log in:', error);
  });
} else {
  console.warn('BOT_TOKEN is not set. Running as an empty health service without connecting to Discord.');
}
