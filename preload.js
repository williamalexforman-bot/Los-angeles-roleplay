'use strict';

// Loaded before index.js. Force the emergency-safe Discord intent set in code
// so an old Render dashboard value cannot keep the gateway from reaching READY.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
console.warn('[DiscordSafeMode] Privileged intents are forced OFF for gateway recovery.');

// Render shared egress can occasionally be rate-limited by Discord/Cloudflare
// on the authenticated GET /gateway/bot route. discord.js normally calls that
// route before opening the WebSocket, which can leave the web service healthy
// while the bot never reaches READY. Patch Client#login before index.js creates
// its client so the WebSocket manager receives a safe single-shard gateway
// record locally and connects directly to Discord's documented gateway URL.
// The bot token is still used normally for the WebSocket IDENTIFY payload.
try {
  const { Client } = require('discord.js');
  const patchKey = Symbol.for('larp.discordGatewayDiscoveryBypass');

  if (!Client.prototype[patchKey]) {
    const originalLogin = Client.prototype.login;

    Object.defineProperty(Client.prototype, patchKey, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    Client.prototype.login = function larpGatewaySafeLogin(token) {
      if (this.ws?.options) {
        this.ws.options.shardCount = 1;
        this.ws.options.shardIds = [0];
        this.ws.options.fetchGatewayInformation = async () => ({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: {
            total: 1000,
            remaining: 1000,
            reset_after: 0,
            max_concurrency: 1,
          },
        });

        console.warn('[DiscordGatewayBypass] Using direct gateway URL; /gateway/bot REST discovery is bypassed.');
      }

      return originalLogin.call(this, token);
    };
  }
} catch (error) {
  console.error('[DiscordGatewayBypass] Could not install gateway discovery bypass:', error instanceof Error ? error.stack || error.message : String(error));
}

process.on('unhandledRejection', reason => {
  const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  console.error('[Runtime] Unhandled promise rejection contained:', message);
});

process.on('uncaughtException', error => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error('[Runtime] Uncaught exception contained:', message);
});

process.on('warning', warning => {
  console.warn('[Runtime] Node warning:', warning?.stack || warning?.message || String(warning));
});

console.log('[InteractionBridge] Preload listener surgery disabled; index.js owns the stable router.');

// ---------------------------------------------------------------------------
// Slash command timeout protection
// ---------------------------------------------------------------------------
// The main router remains authoritative. This only guarantees Discord receives
// an acknowledgement before its short interaction deadline if a command handler
// is slow to load or waiting on I/O.
let interactionSafetyInstalled = false;
const interactionSafetyInstaller = setInterval(() => {
  if (interactionSafetyInstalled) return;
  const client = globalThis.__discordClient;
  if (!client || typeof client.on !== 'function') return;

  interactionSafetyInstalled = true;
  clearInterval(interactionSafetyInstaller);

  client.on('interactionCreate', interaction => {
    if (!interaction?.isChatInputCommand?.()) return;

    const commandName = interaction.commandName || 'unknown';
    const timer = setTimeout(async () => {
      if (!interaction?.isRepliable?.() || interaction.replied || interaction.deferred) return;
      try {
        await interaction.deferReply({ flags: 64 });
        console.warn(`[InteractionSafety] Emergency-deferred /${commandName} before Discord timeout.`);
      } catch (error) {
        console.error(`[InteractionSafety] Failed to acknowledge /${commandName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1_500);

    if (typeof timer.unref === 'function') timer.unref();
  });

  // Warm the giant command registry only after the gateway is READY. This keeps
  // startup safe while ensuring the first user command does not spend its entire
  // response window importing every command module.
  client.once('clientReady', () => {
    setImmediate(() => {
      try {
        const registry = require('./src/commands/registry.ts');
        const count = registry?.commandHandlers instanceof Map ? registry.commandHandlers.size : 0;
        if (registry?.commandHandlers instanceof Map) {
          globalThis.__canonicalCommandHandlers = registry.commandHandlers;
        }
        console.log(`[InteractionSafety] Prewarmed ${count} slash command handlers after READY.`);
      } catch (error) {
        console.error('[InteractionSafety] Command registry prewarm failed:', error instanceof Error ? error.stack || error.message : String(error));
      }
    });
  });

  console.log('[InteractionSafety] Slash-command timeout protection installed.');
}, 100);
if (typeof interactionSafetyInstaller.unref === 'function') interactionSafetyInstaller.unref();

// ---------------------------------------------------------------------------
// Render keepalive + runtime heartbeat
// ---------------------------------------------------------------------------
const RENDER_KEEPALIVE_INTERVAL_MS = 8 * 60_000;
const RUNTIME_HEARTBEAT_INTERVAL_MS = 60_000;
let lastRenderKeepAliveAt = 0;
let lastRenderKeepAliveOk = false;

function renderBaseUrl() {
  const explicit = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const hostname = (process.env.RENDER_EXTERNAL_HOSTNAME || '').trim();
  return hostname ? `https://${hostname}` : '';
}

async function sendRenderKeepAlive() {
  const baseUrl = renderBaseUrl();
  if (!baseUrl) return;
  const url = `${baseUrl}/health`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'User-Agent': 'LARP-Discord-Bot-KeepAlive/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    lastRenderKeepAliveAt = Date.now();
    lastRenderKeepAliveOk = response.ok;
    await response.text().catch(() => '');
    console.log(`[KeepAlive] Render /health self-ping ${response.status} at ${new Date(lastRenderKeepAliveAt).toISOString()}.`);
  } catch (error) {
    lastRenderKeepAliveAt = Date.now();
    lastRenderKeepAliveOk = false;
    console.warn(`[KeepAlive] Render self-ping failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

setTimeout(() => void sendRenderKeepAlive(), 30_000);
setInterval(() => void sendRenderKeepAlive(), RENDER_KEEPALIVE_INTERVAL_MS);

setInterval(() => {
  const client = globalThis.__discordClient;
  const ready = Boolean(client?.isReady?.());
  const keepAliveAgeSeconds = lastRenderKeepAliveAt
    ? Math.floor((Date.now() - lastRenderKeepAliveAt) / 1_000)
    : null;
  console.log(
    `[RuntimeHeartbeat] uptime=${Math.floor(process.uptime())}s discordReady=${ready}`
    + ` keepAliveOk=${lastRenderKeepAliveOk} keepAliveAge=${keepAliveAgeSeconds ?? 'never'}s`,
  );
}, RUNTIME_HEARTBEAT_INTERVAL_MS);

// Never destroy/re-login the Discord client while its first login is pending.
// The gateway manager handles socket reconnects itself once connected.
console.log('[DiscordWatchdog] Destructive reconnect loop disabled.');
console.log('[Runtime] Emergency crash containment active.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
