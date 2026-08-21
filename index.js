// Always load runtime safety/interaction recovery even when the host starts
// this service with `node index.js` instead of `node -r ./preload.js index.js`.
// Node caches required modules, so this is safe when preload.js was already
// loaded with -r.
require('./preload.js');

// Emergency-stable Discord runtime.
// Discord MUST be allowed to log in before any optional feature module loads.
// A broken ticket/application/database module must never keep the whole bot offline.
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });
require('dotenv').config();

try {
  const { logRuntimeEnvironmentAudit } = require('./src/config/env.ts');
  logRuntimeEnvironmentAudit();
} catch (error) {
  console.warn('[EnvAudit] Startup environment audit unavailable:', error instanceof Error ? error.message : String(error));
}

// Custom V2 banners are stored as base64 text so the exact artwork can live
// in the repository even through text-only connector writes. Materialize them
// before any command module tries to attach them.
try {
  const fs = require('fs');
  const path = require('path');
  const assetsDir = path.join(__dirname, 'assets');
  const bannerAssets = [
    ['partnership-banner.b64', 'partnership-banner.webp'],
    ['paid-ad-banner.b64', 'paid-ad-banner.webp'],
    ['activity-check-banner.b64', 'activity-check-banner.jpg'],
  ];
  for (const [sourceName, outputName] of bannerAssets) {
    const source = path.join(assetsDir, sourceName);
    const output = path.join(assetsDir, outputName);
    if (!fs.existsSync(source)) continue;
    const encoded = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
    if (!encoded) continue;
    fs.writeFileSync(output, Buffer.from(encoded, 'base64'));
    console.log(`[Assets] Materialized ${outputName}.`);
  }
} catch (error) {
  console.warn('[Assets] Custom banner materialization failed:', error instanceof Error ? error.message : String(error));
}

const http = require('http');
const renderPort = Number(process.env.PORT || process.env.WEBHOOK_PORT || 10000);
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const discordClient = globalThis.__discordClient;
    const payload = JSON.stringify({
      ok: true,
      discordReady: Boolean(discordClient?.isReady?.()),
      uptimeSeconds: Math.floor(process.uptime()),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
healthServer.on('error', error => {
  console.error('[Health] Server error:', error instanceof Error ? error.message : String(error));
});
healthServer.listen(renderPort, '0.0.0.0', () => {
  console.log(`[Health] Listening on 0.0.0.0:${renderPort}`);
});

const { Client, Events, GatewayIntentBits, Partials, MessageFlags } = require('discord.js');

const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
if (!token) {
  console.error('[FATAL] BOT_TOKEN/TOKEN is missing. Discord cannot start.');
  process.exit(1);
}

const enablePrivileged = String(process.env.ENABLE_PRIVILEGED_INTENTS || 'false').toLowerCase() === 'true';
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.DirectMessages,
];
if (enablePrivileged) {
  intents.push(
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  );
  console.log('[Discord] Privileged intents enabled, including GuildMembers for activity checks.');
} else {
  console.warn('[Discord] Privileged intents disabled. Activity checks cannot safely snapshot the full staff roster until ENABLE_PRIVILEGED_INTENTS=true and Server Members Intent is enabled in the Discord Developer Portal.');
}

const client = new Client({
  intents,
  partials: [Partials.Channel],
});

globalThis.__discordClient = client;

client.on('error', error => console.error('[Discord] Client error:', error?.message || String(error)));
client.on('shardError', error => console.error('[Discord] Shard error:', error?.message || String(error)));
client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected (${event?.code ?? 'unknown'}).`);
});

// Load the stable interaction router directly after ts-node registration.
// There is deliberately no cached lazy promise here: one failed cold import
// must never poison every later Discord interaction for the lifetime of the process.
let interactionCreateStable;
try {
  ({ interactionCreateStable } = require('./src/handlers/interactionCreateStable.ts'));
  if (typeof interactionCreateStable !== 'function') {
    throw new Error('interactionCreateStable export is unavailable.');
  }
  console.log('[Discord] Stable interaction router loaded directly.');
} catch (error) {
  console.error('[Discord] Stable interaction router failed to load:', error instanceof Error ? error.stack || error.message : String(error));
}

globalThis.__indexOwnsStableInteractionBridge = true;
client.on(Events.InteractionCreate, async interaction => {
  const startedAt = Date.now();
  try {
    if (typeof interactionCreateStable !== 'function') {
      throw new Error('Stable interaction router is unavailable.');
    }
    await interactionCreateStable(interaction);
    if (interaction.isChatInputCommand?.()) {
      console.log(`[InteractionBridge] /${interaction.commandName} handled in ${Date.now() - startedAt}ms.`);
    }
  } catch (error) {
    console.error('[InteractionBridge] Stable router failed:', error instanceof Error ? error.stack || error.message : String(error));
    if (!interaction.isRepliable()) return;
    try {
      const content = 'The command system hit an internal error. Please try again in a moment.';
      if (interaction.deferred) await interaction.editReply({ content });
      else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      console.error('[InteractionBridge] Could not acknowledge failed interaction:', replyError instanceof Error ? replyError.message : String(replyError));
    }
  }
});
console.log('[InteractionBridge] Index-owned stable interaction bridge installed.');

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Discord] READY as ${readyClient.user.tag} (${readyClient.user.id})`);

  try {
    const { installBannerInjector } = require('./src/runtime/bannerInjector.ts');
    installBannerInjector(readyClient);
    console.log('[BannerInjector] Partnership and paid-ad V2 banners registered.');
  } catch (error) {
    console.warn('[BannerInjector] Banner injector unavailable:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const activityModule = require('./src/commands/activityCheck.ts');
    const { installActivityCheckLiveRepair } = require('./src/runtime/activityCheckLiveRepair.ts');
    installActivityCheckLiveRepair(activityModule, readyClient);
    console.log('[ActivityCheckLive] Current and future activity checks will live-update response counts.');
  } catch (error) {
    console.warn('[ActivityCheckLive] Live-update repair unavailable:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { registerTicketAiTriage } = require('./src/events/ticketAiTriage.ts');
    registerTicketAiTriage(readyClient);
    console.log('[Tickets] Pre-claim AI triage registered.');
  } catch (error) {
    console.warn('[Tickets] AI triage failed to register:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { registerTicketPriority } = require('./src/events/ticketPriority.ts');
    registerTicketPriority(readyClient);
    console.log('[Tickets] Priority channel naming registered.');
  } catch (error) {
    console.warn('[Tickets] Priority naming failed to register:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { registerTicketAppealNaming } = require('./src/events/ticketAppealNaming.ts');
    registerTicketAppealNaming(readyClient);
    console.log('[Tickets] Generic appeal naming registered.');
  } catch (error) {
    console.warn('[Tickets] Appeal naming override failed to register:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { registerVoiceModeration } = require('./src/events/voiceModeration.ts');
    registerVoiceModeration(readyClient);
    console.log('[VoiceMod] Voice moderation startup hook registered.');
  } catch (error) {
    console.warn('[VoiceMod] Voice moderation unavailable:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { startActivityCheckScheduler } = require('./src/commands/activityCheck.ts');
    startActivityCheckScheduler(readyClient);
    console.log('[ActivityCheck] Scheduler registered.');
  } catch (error) {
    console.warn('[ActivityCheck] Scheduler unavailable:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { startTicketInactivityScheduler } = require('./src/events/ticketInactivity.ts');
    startTicketInactivityScheduler(readyClient);
    console.log('[TicketInactivity] Automatic inactivity system registered.');
  } catch (error) {
    console.warn('[TicketInactivity] Scheduler unavailable:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { onReady } = require('./src/events/ready.ts');
    await onReady(readyClient);
    console.log('[Discord] Slash commands registered.');
  } catch (error) {
    console.error('[Discord] Ready hooks failed:', error instanceof Error ? error.stack || error.message : String(error));
  }

  try {
    const { forceRepairActivityCheckCommand } = require('./src/events/activityCommandRepair.ts');
    await forceRepairActivityCheckCommand(readyClient);
  } catch (error) {
    console.error('[ActivityCheckRepair] Forced repair failed to run:', error instanceof Error ? error.stack || error.message : String(error));
  }

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

console.log('[Discord] Attempting login...');
client.login(token).catch(error => {
  console.error('[FATAL] Discord login failed:', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
