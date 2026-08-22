'use strict';

// Loaded before index.js. Force the emergency-safe Discord intent set in code
// so an old Render dashboard value cannot keep the gateway from reaching READY.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
console.warn('[DiscordSafeMode] Privileged intents are forced OFF for gateway recovery.');

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
// Discord startup diagnostics
// ---------------------------------------------------------------------------
// This never prints the token. It only verifies that Discord accepts the token
// over REST and that Render can reach Discord's gateway discovery endpoint.
async function probeDiscordStartup() {
  const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
  if (!token) {
    console.error('[DiscordProbe] No BOT_TOKEN/TOKEN is available.');
    return;
  }

  const headers = {
    Authorization: `Bot ${token}`,
    'User-Agent': 'LARP-Discord-Bot-Diagnostic/1.0',
  };

  try {
    const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (meResponse.ok) {
      const me = await meResponse.json().catch(() => ({}));
      console.log(`[DiscordProbe] Token accepted by Discord REST (HTTP ${meResponse.status}) for bot ${me.username || 'unknown'} (${me.id || 'unknown'}).`);
    } else {
      const body = await meResponse.text().catch(() => '');
      console.error(`[DiscordProbe] Token rejected by Discord REST: HTTP ${meResponse.status}${body ? ` ${body.slice(0, 180)}` : ''}`);
      return;
    }
  } catch (error) {
    console.error(`[DiscordProbe] Discord REST auth probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  try {
    const gatewayResponse = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (gatewayResponse.ok) {
      const gateway = await gatewayResponse.json().catch(() => ({}));
      console.log(`[DiscordProbe] Gateway discovery succeeded (HTTP ${gatewayResponse.status}); url=${gateway.url || 'missing'} shards=${gateway.shards ?? 'unknown'}.`);
    } else {
      const body = await gatewayResponse.text().catch(() => '');
      console.error(`[DiscordProbe] Gateway discovery failed: HTTP ${gatewayResponse.status}${body ? ` ${body.slice(0, 180)}` : ''}`);
    }
  } catch (error) {
    console.error(`[DiscordProbe] Gateway discovery request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

setTimeout(() => void probeDiscordStartup(), 500);

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

// Do not destroy/re-login the Discord client while its first gateway login is
// still pending. That race can leave the client permanently not-ready.
console.log('[DiscordWatchdog] Destructive reconnect loop disabled; first login may complete normally.');
console.log('[Runtime] Emergency crash containment active.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
