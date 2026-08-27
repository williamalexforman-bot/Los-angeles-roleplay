'use strict';

// Voice moderation was permanently removed. Message-content moderation is
// configured by the active root client in index.js and is not controlled here.
process.env.VOICE_MODERATION_ENABLED = 'false';

// TEMPORARY OWNER SAFETY MODE.
// Server Security was the separate join-protection system that removed bots
// which were not allowlisted and then posted a security/unusual-join alert.
// Keep it completely disabled until the owner explicitly asks to restore it.
process.env.SECURITY_PROTECTION_ENABLED = 'false';

function errorText(error) {
  return error instanceof Error ? (error.stack || error.message) : String(error);
}

// Render has previously returned an HTML 429 for Discord's authenticated
// GET /gateway/bot discovery request. Keep only this narrowly-scoped bypass so
// the gateway can start. All interaction callbacks/replies use discord.js REST.
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

// TEMPORARY MODERATION LOCKDOWN.
// Keep both false until the owner explicitly asks to turn Discord removals back on.
const BAN_ACTIONS_ENABLED = false;
const KICK_ACTIONS_ENABLED = false;

// First layer: block the high-level discord.js APIs themselves. This prevents
// server-security code, commands, and future handlers from ever reaching REST.
try {
  const discord = require('discord.js');
  const highLevelKey = Symbol.for('larp.highLevelRemovalLockdown');

  if (!discord.GuildMember.prototype[highLevelKey]) {
    Object.defineProperty(discord.GuildMember.prototype, highLevelKey, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    discord.GuildMember.prototype.kick = async function larpKickBlocked() {
      const targetId = this?.id || 'unknown';
      console.warn(`[RemovalLockdown] BLOCKED GuildMember.kick target=${targetId}.`);
      const error = new Error('All Discord kicks are temporarily disabled by the server owner.');
      error.code = 'LARP_ALL_KICKS_DISABLED';
      throw error;
    };

    discord.GuildMember.prototype.ban = async function larpMemberBanBlocked() {
      const targetId = this?.id || 'unknown';
      console.warn(`[RemovalLockdown] BLOCKED GuildMember.ban target=${targetId}.`);
      const error = new Error('All Discord bans are temporarily disabled by the server owner.');
      error.code = 'LARP_ALL_BANS_DISABLED';
      throw error;
    };

    if (discord.GuildMemberManager?.prototype?.ban) {
      discord.GuildMemberManager.prototype.ban = async function larpManagerBanBlocked(target) {
        const targetId = typeof target === 'string' ? target : target?.id || target?.user?.id || 'unknown';
        console.warn(`[RemovalLockdown] BLOCKED GuildMemberManager.ban target=${targetId}.`);
        const error = new Error('All Discord bans are temporarily disabled by the server owner.');
        error.code = 'LARP_ALL_BANS_DISABLED';
        throw error;
      };
    }

    console.log('[RemovalLockdown] HIGH-LEVEL GUARD ACTIVE: GuildMember kick/ban and member-manager ban are disabled.');
  }
} catch (error) {
  console.error('[RemovalLockdown] Could not install high-level member-removal guard:', errorText(error));
}

// Second layer: block the raw discord.js REST routes as a backstop.
try {
  const { REST } = require('discord.js');
  const guardKey = Symbol.for('larp.memberRemovalLockdown');

  if (!REST.prototype[guardKey]) {
    const originalPut = REST.prototype.put;
    const originalDelete = REST.prototype.delete;

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
        console.warn(`[RemovalLockdown] BLOCKED Discord ban request route=${routeText}. All bans are temporarily disabled.`);
        const error = new Error('All Discord bans are temporarily disabled by the server owner.');
        error.code = 'LARP_ALL_BANS_DISABLED';
        throw error;
      }

      return originalPut.call(this, route, options);
    };

    REST.prototype.delete = async function larpKickLockdown(route, options) {
      const routeText = String(route || '');
      const isGuildKickRoute = /^\/guilds\/[^/]+\/members\/\d{17,20}(?:$|\?)/.test(routeText);

      if (!KICK_ACTIONS_ENABLED && isGuildKickRoute) {
        console.warn(`[RemovalLockdown] BLOCKED Discord kick request route=${routeText}. All kicks are temporarily disabled.`);
        const error = new Error('All Discord kicks are temporarily disabled by the server owner.');
        error.code = 'LARP_ALL_KICKS_DISABLED';
        throw error;
      }

      return originalDelete.call(this, route, options);
    };

    console.log('[RemovalLockdown] REST GUARD ACTIVE: this bot cannot ban or kick ANY Discord member or bot right now.');
    console.log('[Server Security] DISABLED: automatic bot-join removal/security alerts are off.');
  }
} catch (error) {
  console.error('[RemovalLockdown] Could not install global member-removal guard:', errorText(error));
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
    + ` interaction429=native-rest bans=${BAN_ACTIONS_ENABLED ? 'enabled' : 'disabled'}`
    + ` kicks=${KICK_ACTIONS_ENABLED ? 'enabled' : 'disabled'} security=disabled`,
  );
}, RUNTIME_HEARTBEAT_INTERVAL_MS);

console.log('[DiscordWatchdog] Destructive reconnect loop disabled.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
