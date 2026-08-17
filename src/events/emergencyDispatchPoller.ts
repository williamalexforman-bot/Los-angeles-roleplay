import type { Client } from 'discord.js';
import { processIntegratedEmergencyCalls } from './emergencyDispatchIntegrated';
import { logger } from '../utils/logger';

const ERLC_SERVER_ENDPOINT = 'https://api.erlc.gg/v2/server';
const DEFAULT_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 8_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let nextAllowedAt = 0;

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function rateLimitDelay(response: Response): number {
    const remaining = finiteNumber(response.headers.get('x-ratelimit-remaining'));
    const reset = finiteNumber(response.headers.get('x-ratelimit-reset'));
    const retryAfter = finiteNumber(response.headers.get('retry-after'));

    if (retryAfter !== null && retryAfter > 0) return Math.max(1_000, Math.ceil(retryAfter * 1_000));
    if (remaining === 0 && reset !== null && reset > 0) {
        return Math.max(1_000, Math.ceil(reset * 1_000 - Date.now() + 300));
    }
    return DEFAULT_INTERVAL_MS;
}

async function scan(client: Client): Promise<void> {
    if (running || Date.now() < nextAllowedAt) return;
    const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
    if (!serverKey) return;

    running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const url = new URL(ERLC_SERVER_ENDPOINT);
        url.searchParams.set('Players', 'true');
        url.searchParams.set('EmergencyCalls', 'true');

        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'server-key': serverKey,
            },
            signal: controller.signal,
        });
        nextAllowedAt = Date.now() + rateLimitDelay(response);

        const payload = await response.json().catch(() => null);
        if (response.status === 429) {
            logger.warn('[911 Poller] ER:LC rate limit reached; waiting for the returned reset window.');
            return;
        }
        if (!response.ok || !payload) {
            logger.warn(`[911 Poller] ER:LC emergency-call request failed with HTTP ${response.status}.`);
            return;
        }

        await processIntegratedEmergencyCalls(client, payload);
    } catch (error) {
        nextAllowedAt = Date.now() + 5_000;
        logger.warn(`[911 Poller] Emergency-call scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        clearTimeout(timeout);
        running = false;
    }
}

function schedule(client: Client): void {
    if (timer) clearTimeout(timer);
    const delay = Math.max(250, nextAllowedAt - Date.now(), DEFAULT_INTERVAL_MS);
    timer = setTimeout(async () => {
        await scan(client);
        schedule(client);
    }, delay);
}

export function startEmergencyDispatchHttpPoller(client: Client): void {
    if (timer) clearTimeout(timer);
    nextAllowedAt = 0;
    void scan(client).finally(() => schedule(client));
    logger.info('[911 Poller] HTTP-only emergency-call polling active; Event Webhook is not required.');
}
