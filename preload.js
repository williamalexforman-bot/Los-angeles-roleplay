'use strict';

// Loaded before index.js. Force the emergency-safe Discord intent set in code
// so an old Render dashboard value cannot keep the gateway from reaching READY.
// Slash commands, buttons, tickets, dashboard interactions, DMs, and voice-state
// connections can start without privileged GuildMembers/MessageContent intents.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
console.warn('[DiscordSafeMode] Privileged intents are forced OFF for gateway recovery.');

// Optional Discord/database feature failures must never terminate the entire
// bot process and take commands offline.
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

// index.js owns the one stable InteractionCreate listener directly.
// Preload deliberately does NOT add, remove, replace, or reorder Discord
// interaction listeners.
console.log('[InteractionBridge] Preload listener surgery disabled; index.js owns the stable router.');

// ---------------------------------------------------------------------------
// Render keepalive + runtime heartbeat
// ---------------------------------------------------------------------------
const RENDER_KEEPALIVE_INTERVAL_MS = 8 * 60_000;
const RUNTIME_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
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
  if (!baseUrl) {
    if (process.env.RENDER === 'true') {
      console.warn('[KeepAlive] Render URL is unavailable; cannot self-ping /health.');
    }
    return;
  }

  // index.js currently matches /health exactly, so do not append a query string.
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

setTimeout(() => {
  void sendRenderKeepAlive();
}, 30_000);
setInterval(() => {
  void sendRenderKeepAlive();
}, RENDER_KEEPALIVE_INTERVAL_MS);

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

// If the first Discord gateway login hangs, retry quickly instead of leaving
// the Render web process healthy while the Discord bot remains offline.
const DISCORD_WATCH_INTERVAL_MS = 10_000;
const DISCORD_NOT_READY_GRACE_MS = 20_000;
let discordNotReadySince = 0;
let discordReconnectInProgress = false;

setInterval(async () => {
  const client = globalThis.__discordClient;
  if (!client || typeof client.isReady !== 'function') return;

  if (client.isReady()) {
    discordNotReadySince = 0;
    return;
  }

  if (!discordNotReadySince) {
    discordNotReadySince = Date.now();
    return;
  }

  if (Date.now() - discordNotReadySince < DISCORD_NOT_READY_GRACE_MS) return;
  if (discordReconnectInProgress) return;

  const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
  if (!token || typeof client.login !== 'function') {
    console.error('[DiscordWatchdog] Discord is not ready, but no usable bot token/client login method is available.');
    discordNotReadySince = Date.now();
    return;
  }

  discordReconnectInProgress = true;
  console.warn('[DiscordWatchdog] Discord has not reached READY within 20 seconds. Forcing one clean gateway reconnect.');

  try {
    if (typeof client.destroy === 'function') client.destroy();
    await client.login(token);
    discordNotReadySince = 0;
    console.log('[DiscordWatchdog] Discord reconnect login call completed. Waiting for READY event.');
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    console.error('[DiscordWatchdog] Discord reconnect failed:', message);
    discordNotReadySince = Date.now();
  } finally {
    discordReconnectInProgress = false;
  }
}, DISCORD_WATCH_INTERVAL_MS);

console.log('[Runtime] Emergency crash containment active.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 5 minutes.');
console.log('[DiscordWatchdog] Gateway readiness watchdog active with 20-second recovery grace.');
