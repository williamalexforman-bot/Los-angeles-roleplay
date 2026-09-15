require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('BOT_TOKEN is required.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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
    process.exitCode = 1;
  }
});

client.login(token).catch((error) => {
  console.error('Failed to log in:', error);
  process.exit(1);
});
