'use strict';

// Loaded by Render before index.js. Optional Discord/database feature failures
// must never terminate the entire bot process and take tickets/commands offline.
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
}, DISCORD_WATCH_INTERVAL_MS).unref?.();

console.log('[Runtime] Emergency crash containment active.');
console.log('[DiscordWatchdog] Gateway readiness watchdog active.');
