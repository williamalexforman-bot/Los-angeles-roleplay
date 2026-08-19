// Emergency-stable Discord runtime.
// Keep startup intentionally small so Discord commands/tickets cannot be blocked
// by optional database, ER:LC, quota, or recovery systems.
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });
require('dotenv').config();

const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');

const { interactionCreate } = require('./src/handlers/interactionCreate.ts');
const { onReady } = require('./src/events/ready.ts');
const { startWebhookServer } = require('./src/webhook/server.ts');
const { getDiscordBotToken } = require('./src/config/env.ts');
const { connectDatabase } = require('./src/database/connection.ts');
const { configureInfractionDatabaseAdapter } = require('./src/database/infractionAdapter.ts');
const { configureApplicationSessionDatabaseAdapter } = require('./src/database/applicationSessionAdapter.ts');
const { setDiscordClientForDm } = require('./src/commands/punishment.ts');
const { setBanAppealClient, handleAppealDmMessage } = require('./src/commands/banAppeal.ts');
const { setInfractionAppealClient } = require('./src/commands/infractionAppeal.ts');
const { handleApplicationDmMessage } = require('./src/commands/applications.ts');

const token = getDiscordBotToken();
if (!token) {
  console.error('[FATAL] BOT_TOKEN/TOKEN is missing. Discord cannot start.');
  process.exit(1);
}

// Only request intents required for commands + DM workflows. This avoids a
// privileged-intent rejection taking the whole bot offline.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Make the active client discoverable by diagnostics/recovery helpers.
globalThis.__discordClient = client;

client.on(Events.InteractionCreate, interactionCreate);
client.on(Events.MessageCreate, async message => {
  try {
    if (await handleApplicationDmMessage(message)) return;
    await handleAppealDmMessage(message);
  } catch (error) {
    console.error('[DM] Handler error:', error instanceof Error ? error.message : String(error));
  }
});

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Discord] READY as ${readyClient.user.tag} (${readyClient.user.id})`);

  setDiscordClientForDm(readyClient);
  setBanAppealClient(readyClient);
  setInfractionAppealClient(readyClient);

  // Register slash commands and ticket/session/application ready hooks.
  try {
    await onReady(readyClient);
    console.log('[Discord] Slash commands and ready hooks registered.');
  } catch (error) {
    console.error('[Discord] onReady failed:', error instanceof Error ? error.message : String(error));
  }

  // Database is optional for bringing the bot online. Connect after Discord is
  // already ready so MongoDB can never block commands/tickets from starting.
  void connectDatabase().then(available => {
    if (!available) {
      console.warn('[Database] Unavailable; core Discord commands remain online.');
      return;
    }
    try { configureInfractionDatabaseAdapter(); } catch (error) {
      console.warn('[Database] Infraction adapter unavailable:', error instanceof Error ? error.message : String(error));
    }
    try { configureApplicationSessionDatabaseAdapter(); } catch (error) {
      console.warn('[Database] Application adapter unavailable:', error instanceof Error ? error.message : String(error));
    }
  }).catch(error => {
    console.warn('[Database] Connection failed; core Discord commands remain online:', error instanceof Error ? error.message : String(error));
  });
});

client.on('error', error => {
  console.error('[Discord] Client error:', error.message);
});
client.on('shardError', error => {
  console.error('[Discord] Shard error:', error.message);
});

// Start the health server, but Discord login failure is fatal below; Render can
// no longer keep a useless web-only process alive indefinitely.
try {
  startWebhookServer(client);
} catch (error) {
  console.warn('[Web] Health server failed to start:', error instanceof Error ? error.message : String(error));
}

client.login(token).catch(error => {
  console.error('[FATAL] Discord login failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
