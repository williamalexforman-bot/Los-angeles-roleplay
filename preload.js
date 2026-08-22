'use strict';

// Recovery mode: keep privileged gateway intents off until the core bot is
// stable. Slash commands do not require GuildMembers or MessageContent.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
process.env.VOICE_MODERATION_ENABLED = 'false';
console.warn('[DiscordSafeMode] Privileged intents and voice moderation are OFF during gateway recovery.');

// Render shared egress has been receiving HTTP 429 responses from Discord's
// authenticated GET /gateway/bot endpoint. discord.js asks that REST route for
// gateway metadata before opening its WebSocket. Intercept that one route at
// the REST layer and provide the documented gateway locally. This is more
// reliable than patching Client#login/WebSocket internals because every
// discord.js REST instance goes through REST.prototype.get.
try {
  const { REST } = require('discord.js');
  const patchKey = Symbol.for('larp.gatewayBotRestBypass');

  if (!REST.prototype[patchKey]) {
    const originalGet = REST.prototype.get;

    Object.defineProperty(REST.prototype, patchKey, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    REST.prototype.get = function larpRestGet(route, options) {
      const routeText = String(route || '');
      if (routeText === '/gateway/bot' || routeText.endsWith('/gateway/bot')) {
        console.warn('[DiscordGatewayBypass] Intercepted /gateway/bot; using direct Discord gateway locally.');
        return Promise.resolve({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: {
            total: 1000,
            remaining: 1000,
            reset_after: 0,
            max_concurrency: 1,
          },
        });
      }
      return originalGet.call(this, route, options);
    };

    console.log('[DiscordGatewayBypass] REST gateway-discovery bypass installed.');
  }
} catch (error) {
  console.error('[DiscordGatewayBypass] Could not install REST bypass:', error instanceof Error ? error.stack || error.message : String(error));
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

console.log('[DiscordWatchdog] Destructive reconnect loop disabled.');
console.log('[Runtime] Emergency crash containment active.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
