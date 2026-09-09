'use strict';

require('./preload.js');
require('./src/runtime/csrpOutboundSanitizer.js');
require('ts-node').register({
  transpileOnly: true,
  project: require('path').join(__dirname, 'tsconfig.json'),
});
require('dotenv').config();

const http = require('http');
const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} = require('discord.js');

const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
const healthcheckOnly = String(process.env.CI_HEALTHCHECK_ONLY || '').toLowerCase() === 'true';
if (!token && !healthcheckOnly) {
  console.error('[FATAL] BOT_TOKEN/TOKEN is missing.');
  process.exit(1);
}

const messageModerationEnabled = String(process.env.ENABLE_MESSAGE_MODERATION || 'true').toLowerCase() !== 'false';
const privilegedIntentsEnabled = String(process.env.ENABLE_PRIVILEGED_INTENTS || 'true').toLowerCase() === 'true';
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
];
if (messageModerationEnabled) intents.push(GatewayIntentBits.MessageContent);
if (privilegedIntentsEnabled) intents.push(GatewayIntentBits.GuildMembers);

const client = new Client({
  intents,
  partials: [Partials.Channel],
});
globalThis.__discordClient = client;
globalThis.__indexOwnsStableInteractionBridge = true;

console.log(`[MessageModeration] Curse/raid message monitoring ${messageModerationEnabled ? 'ENABLED' : 'DISABLED'}.`);
console.log(`[MemberLifecycle] Join events ${privilegedIntentsEnabled ? 'ENABLED' : 'DISABLED (set ENABLE_PRIVILEGED_INTENTS=true)'}.`);

function restErrorMeta(error) {
  const status = error?.status ?? error?.rawError?.status ?? error?.response?.status ?? 'unknown';
  const code = error?.code ?? error?.rawError?.code ?? 'unknown';
  const retryAfter = error?.retryAfter ?? error?.rawError?.retry_after ?? error?.response?.headers?.get?.('retry-after') ?? 'unknown';
  return `status=${status} code=${code} retryAfter=${retryAfter} message=${error?.message || String(error)}`;
}

client.rest.on('rateLimited', info => {
  console.warn(
    `[DiscordREST] RATE_LIMITED global=${Boolean(info?.global)}`
    + ` timeToReset=${info?.timeToReset ?? 'unknown'}ms`
    + ` limit=${info?.limit ?? 'unknown'} method=${info?.method ?? 'unknown'}`
    + ` route=${info?.route ?? info?.hash ?? 'unknown'}`,
  );
});
client.rest.on('invalidRequestWarning', info => {
  console.warn(`[DiscordREST] INVALID_REQUEST_WARNING count=${info?.count ?? 'unknown'} remaining=${info?.remainingTime ?? 'unknown'}ms`);
});
client.rest.on('response', (request, response) => {
  const status = Number(response?.status || 0);
  if (status >= 400) {
    console.error(
      `[DiscordREST] HTTP ${status} method=${request?.method ?? 'unknown'}`
      + ` route=${request?.route ?? request?.fullRoute ?? 'unknown'}`
      + ` retryAfter=${response?.headers?.get?.('retry-after') ?? 'none'}`,
    );
  }
});

const port = Number(process.env.PORT || process.env.WEBHOOK_PORT || 10000);
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      discordReady: client.isReady(),
      uptimeSeconds: Math.floor(process.uptime()),
      interactionListeners: client.listenerCount(Events.InteractionCreate),
      interactionTransport: 'discord.js-native',
      messageModerationEnabled,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
server.listen(port, '0.0.0.0', () => {
  console.log(`[Health] Listening on 0.0.0.0:${port}`);
});

client.on('error', error => {
  console.error('[Discord] Client error:', error?.stack || error?.message || String(error));
});
client.on('shardError', error => {
  console.error('[Discord] Shard error:', error?.stack || error?.message || String(error));
});
client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected code=${event?.code ?? 'unknown'}.`);
});
client.on('shardReady', shardId => {
  console.log(`[DiscordGateway] Shard ${shardId} READY.`);
});
client.on('shardResume', (shardId, replayed) => {
  console.log(`[DiscordGateway] Shard ${shardId} resumed replayed=${replayed}.`);
});
client.on('shardReconnecting', shardId => {
  console.warn(`[DiscordGateway] Shard ${shardId} reconnecting.`);
});

client.on('raw', packet => {
  if (packet?.t !== 'INTERACTION_CREATE') return;
  const name = packet?.d?.data?.name || 'component';
  const id = packet?.d?.id || 'unknown';
  console.log(`[RawInteraction] INTERACTION_CREATE name=${name} id=${id}.`);
});

let routeProductionMessage = null;
try {
  const productionRuntime = require('./src/events/productionRuntime.ts');
  productionRuntime.configureProductionRuntime(client);
  routeProductionMessage = productionRuntime.routeProductionMessage;
  if (typeof routeProductionMessage !== 'function') throw new Error('routeProductionMessage export missing');
  console.log('[Runtime] Application DMs, ban-appeal DMs, punishment DMs, persistence, and message routing loaded.');
} catch (error) {
  console.error('[Runtime] Production command wiring failed to load:', error?.stack || error?.message || String(error));
}

client.on(Events.MessageCreate, async message => {
  if (typeof routeProductionMessage !== 'function') return;
  try {
    await routeProductionMessage(message, messageModerationEnabled);
  } catch (error) {
    console.error('[Runtime] Message handler failed:', error?.stack || error?.message || String(error));
  }
});

let stableRouter = null;
try {
  ({ interactionCreateStable: stableRouter } = require('./src/handlers/interactionCreateStable.ts'));
  if (typeof stableRouter !== 'function') throw new Error('interactionCreateStable export missing');
  console.log('[InteractionBridge] Stable router loaded.');
} catch (error) {
  console.error('[InteractionBridge] Stable router failed to load:', error?.stack || error?.message || String(error));
}

const HIGH_RANK_SESSION_COMMANDS = new Set([
  'session-start',
  'session-vote',
  'session-end',
  'session-boost',
  'session-full',
]);

async function enforceHighRankSessionPermission(interaction) {
  if (!interaction.isChatInputCommand?.() || !HIGH_RANK_SESSION_COMMANDS.has(interaction.commandName)) return true;
  if (!interaction.guild) return false;

  const resolver = interaction.client?.serverResourceResolver;
  let highRankRole = null;
  if (resolver?.findStaffRole) {
    highRankRole = await resolver.findStaffRole(interaction.guild, 'highRank').catch(() => null);
  }
  if (!highRankRole) {
    highRankRole = interaction.guild.roles.cache.find(role => {
      const name = String(role.name || '').toLowerCase().replace(/[│┃｜|]/g, ' ').replace(/[_\s]+/g, '-');
      return name === 'high-rank' || name === 'csrp-high-rank' || name.includes('high-rank');
    }) || null;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const allowed = Boolean(highRankRole && member?.roles.cache.has(highRankRole.id));
  if (allowed) return true;

  const message = highRankRole
    ? `You need the <@&${highRankRole.id}> role to use session commands.`
    : 'You need the **High Rank** role to use session commands. The bot could not find that role, so this command was blocked safely.';

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  } else {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
  return false;
}

async function stableInteractionListener(interaction) {
  const startedAt = Date.now();
  const isSlash = interaction.isChatInputCommand?.() === true;
  const name = isSlash ? interaction.commandName : interaction.customId || interaction.type;

  console.log(
    `[InteractionBridge] RECEIVED ${isSlash ? '/' : ''}${name}`
    + ` id=${interaction.id} guild=${interaction.guildId || 'DM'}`,
  );

  if (typeof stableRouter !== 'function') {
    console.error(`[InteractionBridge] ROUTER UNAVAILABLE for ${name}.`);
    return;
  }

  try {
    if (!(await enforceHighRankSessionPermission(interaction))) {
      console.log(`[SessionPermission] BLOCKED /${name} for user=${interaction.user?.id || 'unknown'}; High Rank required.`);
      return;
    }
    await stableRouter(interaction);
    console.log(
      `[InteractionBridge] HANDLED ${name} in ${Date.now() - startedAt}ms`
      + ` replied=${interaction.replied} deferred=${interaction.deferred}.`,
    );
  } catch (error) {
    console.error(`[InteractionBridge] ROUTER ERROR ${name}: ${restErrorMeta(error)}`);
    if (error?.stack) console.error(error.stack);
  }
}

function enforceSingleInteractionRouter(reason) {
  const listeners = client.listeners(Events.InteractionCreate);
  if (listeners.length === 1 && listeners[0] === stableInteractionListener) return;

  const extraCount = listeners.filter(listener => listener !== stableInteractionListener).length;
  client.removeAllListeners(Events.InteractionCreate);
  client.on(Events.InteractionCreate, stableInteractionListener);
  console.warn(
    `[InteractionBridge] ENFORCED single stable router reason=${reason}`
    + ` removedExtra=${extraCount} listenersNow=${client.listenerCount(Events.InteractionCreate)}.`,
  );
}

enforceSingleInteractionRouter('startup');
console.log(`[InteractionBridge] Single native command listener installed. listeners=${client.listenerCount(Events.InteractionCreate)}.`);

const interactionRouterGuard = setInterval(() => {
  if (client.listenerCount(Events.InteractionCreate) !== 1
      || client.listeners(Events.InteractionCreate)[0] !== stableInteractionListener) {
    enforceSingleInteractionRouter('runtime-guard');
  }
}, 30_000);
interactionRouterGuard.unref?.();

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Discord] READY as ${readyClient.user.tag} (${readyClient.user.id})`);
  enforceSingleInteractionRouter('client-ready');
  console.log(`[InteractionBridge] READY listener count=${readyClient.listenerCount(Events.InteractionCreate)}.`);
  console.log('[DiscordREST] Passive logging only; startup canary disabled so READY does not make an extra REST request.');

  try {
    const { registerServerResourceResolver } = require('./src/services/serverResourceResolver.ts');
    await registerServerResourceResolver(readyClient);
  } catch (error) {
    console.error('[AutoFinder] Could not initialize automatic channel/role discovery:', error?.stack || error?.message || String(error));
  }

  try {
    const { registerTicketArtworkConsistency } = require('./src/events/ticketArtworkConsistency.ts');
    registerTicketArtworkConsistency(readyClient);
  } catch (error) {
    console.error('[TicketArtwork] Could not register ticket artwork consistency:', error?.stack || error?.message || String(error));
  }

  try {
    const { onReady } = require('./src/events/ready.ts');
    void onReady(readyClient)
      .then(() => {
        enforceSingleInteractionRouter('ready-hooks-complete');
        console.log('[Discord] Ready hooks completed.');
      })
      .catch(error => console.error('[Discord] Ready hooks failed:', error?.stack || error?.message || String(error)));
  } catch (error) {
    console.error('[Discord] Could not load ready hooks:', error?.stack || error?.message || String(error));
  }
});

if (healthcheckOnly) {
  console.log('[Discord] CI health-check mode enabled; gateway login skipped.');
} else {
  console.log('[Discord] Attempting login...');
  client.login(token).catch(error => {
    console.error('[FATAL] Discord login failed:', error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
