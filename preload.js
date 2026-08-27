'use strict';

// Voice moderation was permanently removed. Message-content moderation is
// configured by the active root client in index.js and is not controlled here.
process.env.VOICE_MODERATION_ENABLED = 'false';

function errorText(error) {
  return error instanceof Error ? (error.stack || error.message) : String(error);
}

// Render has previously returned an HTML 429 for Discord's authenticated
// GET /gateway/bot discovery request. Keep only this narrowly-scoped bypass so
// the gateway can start. All interaction callbacks/replies now use discord.js's
// native REST implementation again.
try {
  const { REST } = require('discord.js');
  const patchKey = Symbol.for('larp.discordGatewayDiscoveryBypass');

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

    console.log('[DiscordGatewayBypass] Gateway-discovery bypass installed.');
    console.log('[InteractionTransport] Native discord.js REST restored for all interaction replies.');
  }
} catch (error) {
  console.error('[DiscordRecovery] Could not install gateway-discovery bypass:', errorText(error));
}

// TEMPORARY BAN LOCKDOWN.
// Keep this false until the owner explicitly asks to turn Discord banning back on.
// This blocks every normal discord.js guild-ban request at the REST layer, so it
// applies to /ban, /punish ban, automated systems, and future command paths.
const BAN_ACTIONS_ENABLED = false;

try {
  const { REST } = require('discord.js');
  const guardKey = Symbol.for('larp.allBansDisabled');

  if (!REST.prototype[guardKey]) {
    const originalPut = REST.prototype.put;

    Object.defineProperty(REST.prototype, guardKey, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    REST.prototype.put = async function larpBanLockdown(route, options) {
      const routeText = String(route || '');
      const isGuildBanRoute = /^\/guilds\/[^/]+\/bans\/\d{17,20}(?:$|\?)/.test(routeText);

      if (!BAN_ACTIONS_ENABLED && isGuildBanRoute) {
        console.warn(`[BanLockdown] BLOCKED Discord ban request route=${routeText}. All bans are temporarily disabled.`);
        const error = new Error('All Discord bans are temporarily disabled by the server owner.');
        error.code = 'LARP_ALL_BANS_DISABLED';
        throw error;
      }

      return originalPut.call(this, route, options);
    };

    console.log('[BanLockdown] ACTIVE: this bot cannot ban ANY Discord user or bot right now.');
  }
} catch (error) {
  console.error('[BanLockdown] Could not install global ban guard:', errorText(error));
}

process.on('warning', warning => {
  console.warn('[Runtime] Node warning:', warning?.stack || warning?.message || String(warning));
});
console.log('[Runtime] Native Node crash behavior restored; fatal errors can restart cleanly.');
console.log('[InteractionBridge] index.js owns the stable interaction router.');

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
    console.warn(`[KeepAlive] Render self-ping failed: ${errorText(error)}`);
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
    + ` keepAliveOk=${lastRenderKeepAliveOk} keepAliveAge=${keepAliveAgeSeconds ?? 'never'}s`
    + ` interaction429=native-rest bans=${BAN_ACTIONS_ENABLED ? 'enabled' : 'disabled'}`,
  );
}, RUNTIME_HEARTBEAT_INTERVAL_MS);

console.log('[DiscordWatchdog] Destructive reconnect loop disabled.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
