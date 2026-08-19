// Emergency-stable Discord runtime.
// Discord MUST be allowed to log in before any optional feature module loads.
// A broken ticket/application/database module must never keep the whole bot offline.
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });
require('dotenv').config();

const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
if (!token) {
  console.error('[FATAL] BOT_TOKEN/TOKEN is missing. Discord cannot start.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

globalThis.__discordClient = client;

client.on('error', error => console.error('[Discord] Client error:', error?.message || String(error)));
client.on('shardError', error => console.error('[Discord] Shard error:', error?.message || String(error)));
client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected (${event?.code ?? 'unknown'}).`);
});

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Discord] READY as ${readyClient.user.tag} (${readyClient.user.id})`);

  // Load the interaction router only AFTER Discord is online.
  try {
    const { interactionCreate } = require('./src/handlers/interactionCreate.ts');
    readyClient.on(Events.InteractionCreate, interactionCreate);
    console.log('[Discord] Interaction router loaded.');
  } catch (error) {
    console.error('[Discord] Interaction router failed to load:', error instanceof Error ? error.stack || error.message : String(error));
  }

  // Register slash commands / ready-time systems after the router is attached.
  try {
    const { onReady } = require('./src/events/ready.ts');
    await onReady(readyClient);
    console.log('[Discord] Slash commands registered.');
  } catch (error) {
    console.error('[Discord] Ready hooks failed:', error instanceof Error ? error.stack || error.message : String(error));
  }

  // Optional DM helpers. Each loads independently so one cannot break another.
  try {
    const { setDiscordClientForDm } = require('./src/commands/punishment.ts');
    setDiscordClientForDm(readyClient);
  } catch (error) {
    console.warn('[Feature] Punishment DM helper unavailable:', error instanceof Error ? error.message : String(error));
  }

  try {
    const { setBanAppealClient, handleAppealDmMessage } = require('./src/commands/banAppeal.ts');
    setBanAppealClient(readyClient);
    readyClient.on(Events.MessageCreate, async message => {
      try { await handleAppealDmMessage(message); } catch (error) {
        console.warn('[DM] Appeal handler failed:', error instanceof Error ? error.message : String(error));
      }
    });
  } catch (error) {
    console.warn('[Feature] Ban appeal helper unavailable:', error instanceof Error ? error.message : String(error));
  }

  try {
    const { setInfractionAppealClient } = require('./src/commands/infractionAppeal.ts');
    setInfractionAppealClient(readyClient);
  } catch (error) {
    console.warn('[Feature] Infraction appeal helper unavailable:', error instanceof Error ? error.message : String(error));
  }

  try {
    const { handleApplicationDmMessage } = require('./src/commands/applications.ts');
    readyClient.on(Events.MessageCreate, async message => {
      try { await handleApplicationDmMessage(message); } catch (error) {
        console.warn('[DM] Application handler failed:', error instanceof Error ? error.message : String(error));
      }
    });
  } catch (error) {
    console.warn('[Feature] Application DM helper unavailable:', error instanceof Error ? error.message : String(error));
  }

  // Database is deliberately last and non-blocking.
  try {
    const { connectDatabase } = require('./src/database/connection.ts');
    void connectDatabase().then(available => {
      console.log(`[Database] ${available ? 'Connected.' : 'Unavailable; Discord remains online.'}`);
      if (!available) return;
      try {
        const { configureInfractionDatabaseAdapter } = require('./src/database/infractionAdapter.ts');
        configureInfractionDatabaseAdapter();
      } catch (error) {
        console.warn('[Database] Infraction adapter unavailable:', error instanceof Error ? error.message : String(error));
      }
      try {
        const { configureApplicationSessionDatabaseAdapter } = require('./src/database/applicationSessionAdapter.ts');
        configureApplicationSessionDatabaseAdapter();
      } catch (error) {
        console.warn('[Database] Application adapter unavailable:', error instanceof Error ? error.message : String(error));
      }
    }).catch(error => console.warn('[Database] Connection failed:', error instanceof Error ? error.message : String(error)));
  } catch (error) {
    console.warn('[Database] Module unavailable; Discord remains online:', error instanceof Error ? error.message : String(error));
  }
});

// Login is intentionally attempted BEFORE importing any bot feature module.
console.log('[Discord] Attempting login...');
client.login(token).catch(error => {
  console.error('[FATAL] Discord login failed:', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
