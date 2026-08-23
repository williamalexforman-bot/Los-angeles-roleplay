'use strict';

// Recovery mode: keep privileged gateway intents off until the core bot is
// stable. Slash commands do not require GuildMembers or MessageContent.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
process.env.VOICE_MODERATION_ENABLED = 'false';
console.warn('[DiscordSafeMode] Privileged intents and voice moderation are OFF during gateway recovery.');

function errorText(error) {
  return error instanceof Error ? (error.stack || error.message) : String(error);
}

function isInteractionRoute(routeText) {
  return routeText.startsWith('/interactions/') || routeText.startsWith('/webhooks/');
}

function appendQuery(url, query) {
  if (!query) return url;
  try {
    if (query instanceof URLSearchParams) {
      const text = query.toString();
      return text ? `${url}?${text}` : url;
    }
    if (typeof query === 'object') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      const text = params.toString();
      return text ? `${url}?${text}` : url;
    }
  } catch {
    // Ignore malformed optional query data and use the route as-is.
  }
  return url;
}

function retryAfterMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30_000;
  // Discord/Cloudflare responses seen on Render have returned values such as
  // 24632. Treat large integer values as milliseconds and ordinary decimal
  // values as seconds. Always allow a little extra recovery time.
  const parsed = numeric > 1_000 ? numeric : numeric * 1_000;
  return Math.max(30_000, Math.min(parsed + 5_000, 10 * 60_000));
}

function interactionRateLimitRemainingMs() {
  const until = Number(globalThis.__discordInteractionRateLimitedUntil || 0);
  return Math.max(0, until - Date.now());
}

function makeCircuitBreakerError(remainingMs) {
  const error = new Error(`Discord interaction REST circuit breaker active for ${Math.ceil(remainingMs / 1000)}s after HTTP 429.`);
  error.status = 429;
  error.code = 'INTERACTION_RATE_LIMIT_CIRCUIT_OPEN';
  return error;
}

async function directDiscordRequest(method, route, options = {}) {
  const routeText = String(route || '');

  if (isInteractionRoute(routeText)) {
    const remainingMs = interactionRateLimitRemainingMs();
    if (remainingMs > 0) {
      throw makeCircuitBreakerError(remainingMs);
    }
  }

  let url = `https://discord.com/api/v10${routeText}`;
  url = appendQuery(url, options.query);

  const init = {
    method,
    headers: {
      'User-Agent': 'DiscordBot (LARP-Recovery, 1.0)',
    },
    signal: AbortSignal.timeout(12_000),
  };

  const files = Array.isArray(options.files) ? options.files : [];
  if (files.length) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(options.body ?? {}));
    files.forEach((file, index) => {
      const data = file?.data ?? file?.file ?? Buffer.alloc(0);
      const type = file?.contentType || file?.content_type || 'application/octet-stream';
      const name = file?.name || `file${index}`;
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      form.append(`files[${index}]`, blob, name);
    });
    init.body = form;
  } else if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const responseText = await response.text();

  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset-after') || 'none';
    const safeBody = responseText.slice(0, 300).replace(/\s+/g, ' ');

    if (response.status === 429 && isInteractionRoute(routeText)) {
      const blockMs = retryAfterMs(retryAfter);
      globalThis.__discordInteractionRateLimitedUntil = Date.now() + blockMs;
      console.error(`[InteractionTransport] Discord/Cloudflare HTTP 429 detected. Circuit breaker opened for ${Math.ceil(blockMs / 1000)}s; duplicate interaction retries will be suppressed.`);
    }

    const error = new Error(`Direct Discord ${method} failed HTTP ${response.status} retryAfter=${retryAfter} body=${safeBody}`);
    error.status = response.status;
    throw error;
  }

  if (!responseText) return undefined;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

// Render shared egress has been receiving Discord/Cloudflare REST rate limits.
// Keep gateway discovery off /gateway/bot and route interaction callbacks
// directly instead of through discord.js's REST queue/global-rate-limit state.
try {
  const { REST } = require('discord.js');
  const patchKey = Symbol.for('larp.discordRestRecoveryBypass');

  if (!REST.prototype[patchKey]) {
    const originalGet = REST.prototype.get;
    const originalPost = REST.prototype.post;
    const originalPatch = REST.prototype.patch;
    const originalDelete = REST.prototype.delete;

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
      if (isInteractionRoute(routeText)) {
        return directDiscordRequest('GET', routeText, options);
      }
      return originalGet.call(this, route, options);
    };

    REST.prototype.post = function larpRestPost(route, options) {
      const routeText = String(route || '');
      if (isInteractionRoute(routeText)) {
        console.log('[InteractionTransport] Direct POST interaction callback route used.');
        return directDiscordRequest('POST', routeText, options);
      }
      return originalPost.call(this, route, options);
    };

    REST.prototype.patch = function larpRestPatch(route, options) {
      const routeText = String(route || '');
      if (isInteractionRoute(routeText)) {
        console.log('[InteractionTransport] Direct PATCH interaction response route used.');
        return directDiscordRequest('PATCH', routeText, options);
      }
      return originalPatch.call(this, route, options);
    };

    REST.prototype.delete = function larpRestDelete(route, options) {
      const routeText = String(route || '');
      if (isInteractionRoute(routeText)) {
        console.log('[InteractionTransport] Direct DELETE interaction response route used.');
        return directDiscordRequest('DELETE', routeText, options);
      }
      return originalDelete.call(this, route, options);
    };

    console.log('[DiscordGatewayBypass] REST gateway-discovery bypass installed.');
    console.log('[InteractionTransport] Direct interaction REST transport installed with 429 circuit breaker.');
  }
} catch (error) {
  console.error('[DiscordRecovery] Could not install REST recovery bypass:', errorText(error));
}

process.on('warning', warning => {
  console.warn('[Runtime] Node warning:', warning?.stack || warning?.message || String(warning));
});
console.log('[Runtime] Native Node crash behavior restored; fatal errors can restart cleanly.');
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
  const interactionRateLimitSeconds = Math.ceil(interactionRateLimitRemainingMs() / 1000);
  console.log(
    `[RuntimeHeartbeat] uptime=${Math.floor(process.uptime())}s discordReady=${ready}`
    + ` keepAliveOk=${lastRenderKeepAliveOk} keepAliveAge=${keepAliveAgeSeconds ?? 'never'}s`
    + ` interaction429=${interactionRateLimitSeconds}s`,
  );
}, RUNTIME_HEARTBEAT_INTERVAL_MS);

console.log('[DiscordWatchdog] Destructive reconnect loop disabled.');
console.log('[KeepAlive] Render self-keepalive scheduled every 8 minutes.');
console.log('[RuntimeHeartbeat] Runtime heartbeat scheduled every 60 seconds.');
