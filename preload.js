'use strict';

// Loaded before index.js. Optional Discord/database feature failures must never
// terminate the entire bot process and take commands offline.
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
// interaction listeners. This prevents startup timing races and protects
// auxiliary listeners such as Activity Check live refresh observers.
console.log('[InteractionBridge] Preload listener surgery disabled; index.js owns the stable router.');

// ---------------------------------------------------------------------------
// Render keepalive + runtime heartbeat
// ---------------------------------------------------------------------------
// Render exposes RENDER_EXTERNAL_URL automatically for web services. Free web
// services can idle after 15 minutes without inbound traffic, so issue a small
// request to our own /health endpoint every 8 minutes. This is deliberately
// well below the idle window and also produces a log proving the keepalive is
// actually succeeding instead of assuming some outside monitor is working.
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

  const url = `${baseUrl}/health?source=self-keepalive&t=${Date.now()}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'User-Agent': 'LARP-Discord-Bot-KeepAlive/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    lastRenderKeepAliveAt = Date.now();
    lastRenderKeepAliveOk = response.ok;
    // Consume the response so the underlying connection can be cleanly reused.
    await response.text().catch(() => '');
    console.log(`[KeepAlive] Render /health self-ping ${response.status} at ${new Date(lastRenderKeepAliveAt).toISOString()}.`);
  } catch (error) {
    lastRenderKeepAliveAt = Date.now();
    lastRenderKeepAliveOk = false;
    console.warn(`[KeepAlive] Render self-ping failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Start shortly after boot, then repeat every eight minutes.
setTimeout(() => {
  void sendRenderKeepAlive();
}, 30_000);
setInterval(() => {
  void sendRenderKeepAlive();
}, RENDER_KEEPALIVE_INTERVAL_MS);

// A separate heartbeat makes it obvious in Render logs whether Node itself is
// still alive and whether Discord is connected at that exact moment.
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

// Render can report the web service as Live while the Discord gateway is no
// longer ready. Watch the globally exposed discord.js Client and force a clean
// reconnect when it remains disconnected for more than two minutes.
const DISCORD_WATCH_INTERVAL_MS = 30_000;
const DISCORD_NOT_READY_GRACE_MS = 2 * 60_000;
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
  console.warn('[DiscordWatchdog] Discord has remained not-ready for over 2 minutes. Forcing a gateway reconnect.');

  try {
    if (typeof client.destroy === 'function') client.destroy();
    await client.login(token);
    discordNotReadySince = 0;
    console.log('[DiscordWatchdog] Discord reconnect completed successfully.');
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
console.log('[DiscordWatchdog] Gateway readiness watchdog active.');
