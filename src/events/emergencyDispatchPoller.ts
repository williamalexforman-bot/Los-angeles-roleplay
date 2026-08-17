import type { Client } from 'discord.js';
import { processIntegratedEmergencyCalls } from './emergencyDispatchIntegrated';
import { logger } from '../utils/logger';

const ERLC_SERVER_ENDPOINT = 'https://api.erlc.gg/v2/server';
const DEFAULT_INTERVAL_MS = 3_000;
const MIN_INTERVAL_MS = 1_500;
const MAX_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let nextAllowedAt = 0;
let lastVisibleCallSignature = '';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function resetEpochMs(value: unknown): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return parsed >= 1_000_000_000_000 ? parsed : parsed * 1_000;
}

/** Pace the next request from ER:LC's returned headers instead of guessing. */
function rateLimitDelay(response: Response): number {
    const retryAfter = finiteNumber(response.headers.get('retry-after'));
    if (retryAfter !== null && retryAfter > 0) {
        return clamp(Math.ceil(retryAfter * 1_000) + 250, MIN_INTERVAL_MS, 60_000);
    }

    const remaining = finiteNumber(response.headers.get('x-ratelimit-remaining'));
    const resetAt = resetEpochMs(response.headers.get('x-ratelimit-reset'));
    if (remaining !== null && resetAt !== null && resetAt > Date.now()) {
        if (remaining <= 0) {
            return clamp(resetAt - Date.now() + 300, MIN_INTERVAL_MS, 60_000);
        }
        // Spread the remaining requests across the rest of the current window.
        const paced = Math.ceil((resetAt - Date.now()) / Math.max(1, remaining));
        return clamp(paced, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    }

    return DEFAULT_INTERVAL_MS;
}

interface LivePlayerLocation {
    id: string;
    username: string;
    x: number | null;
    z: number | null;
    postal: string | null;
    street: string | null;
}

function playerIdentity(value: unknown): { username: string; id: string } | null {
    const raw = text(value);
    if (!raw) return null;
    const split = raw.lastIndexOf(':');
    if (split <= 0 || split >= raw.length - 1) return null;
    const username = raw.slice(0, split).trim();
    const id = raw.slice(split + 1).trim();
    if (!username || !/^\d+$/.test(id)) return null;
    return { username, id };
}

function buildPlayerIndex(payload: UnknownRecord): Map<string, LivePlayerLocation> {
    const index = new Map<string, LivePlayerLocation>();
    const rawPlayers = Array.isArray(payload.Players)
        ? payload.Players
        : Array.isArray(payload.players)
            ? payload.players
            : [];

    for (const rawPlayer of rawPlayers) {
        if (!isRecord(rawPlayer)) continue;
        const identity = playerIdentity(rawPlayer.Player ?? rawPlayer.player);
        if (!identity) continue;
        const location = isRecord(rawPlayer.Location)
            ? rawPlayer.Location
            : isRecord(rawPlayer.location)
                ? rawPlayer.location
                : null;
        index.set(identity.id, {
            id: identity.id,
            username: identity.username,
            x: location ? finiteNumber(location.LocationX ?? location.locationX ?? location.X ?? location.x) : null,
            z: location ? finiteNumber(location.LocationZ ?? location.locationZ ?? location.Z ?? location.z) : null,
            postal: location ? text(location.PostalCode ?? location.postalCode ?? location.postal) : null,
            street: location ? text(location.StreetName ?? location.streetName ?? location.street) : null,
        });
    }
    return index;
}

function callerId(value: unknown): string | null {
    const numeric = finiteNumber(value);
    if (numeric !== null && numeric > 0) return String(Math.trunc(numeric));
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) return trimmed;
        const identity = playerIdentity(trimmed);
        if (identity) return identity.id;
    }
    if (isRecord(value)) {
        const nested = finiteNumber(value.UserId ?? value.userId ?? value.Id ?? value.id);
        if (nested !== null && nested > 0) return String(Math.trunc(nested));
    }
    return null;
}

function positionPair(call: UnknownRecord): [number, number] | null {
    const position = call.Position ?? call.position;
    if (Array.isArray(position)) {
        const x = finiteNumber(position[0]);
        const z = finiteNumber(position[1]);
        if (x !== null && z !== null) return [x, z];
    }
    if (isRecord(position)) {
        const x = finiteNumber(position.X ?? position.x ?? position.LocationX ?? position.locationX);
        const z = finiteNumber(position.Z ?? position.z ?? position.LocationZ ?? position.locationZ);
        if (x !== null && z !== null) return [x, z];
    }
    const x = finiteNumber(call.LocationX ?? call.locationX ?? call.X ?? call.x);
    const z = finiteNumber(call.LocationZ ?? call.locationZ ?? call.Z ?? call.z);
    return x !== null && z !== null ? [x, z] : null;
}

/**
 * Normalize live player-created calls before handing them to the panel layer.
 * The official API uses numeric Caller IDs; matching them to Players lets us
 * preserve player calls even when a response omits a convenient username or
 * uses a different Position representation.
 */
function normalizeEmergencyPayload(payload: unknown): UnknownRecord | null {
    if (!isRecord(payload)) return null;
    const players = buildPlayerIndex(payload);
    const rawCalls = Array.isArray(payload.EmergencyCalls)
        ? payload.EmergencyCalls
        : Array.isArray(payload.emergencyCalls)
            ? payload.emergencyCalls
            : [];

    const normalizedCalls = rawCalls.map(rawCall => {
        if (!isRecord(rawCall)) return rawCall;
        const call: UnknownRecord = { ...rawCall };
        const id = callerId(call.Caller ?? call.caller ?? call.Player ?? call.player ?? call.User ?? call.user);
        const player = id ? players.get(id) : null;

        if (id && player) {
            // Preserve the numeric identity while also giving the panel a name.
            call.Caller = `${player.username}:${id}`;

            if (!positionPair(call) && player.x !== null && player.z !== null) {
                call.Position = [player.x, player.z];
            }

            const currentDescriptor = text(
                call.PositionDescriptor
                ?? call.positionDescriptor
                ?? call.LocationDescriptor
                ?? call.locationDescriptor,
            );
            if (!currentDescriptor) {
                const location = [
                    player.street,
                    player.postal ? `Postal ${player.postal}` : null,
                ].filter(Boolean).join(' • ');
                if (location) call.PositionDescriptor = location;
            } else if (player.postal && !currentDescriptor.toLowerCase().includes('postal')) {
                call.PositionDescriptor = `${currentDescriptor} • Postal ${player.postal}`;
            }
        }

        // The documented response contains Position, but never throw away an
        // otherwise valid player call solely because a live response omitted it.
        if (!positionPair(call) && id) {
            call.Position = [0, 0];
            call.PositionDescriptor = text(call.PositionDescriptor ?? call.positionDescriptor)
                || 'Player 911 call — exact map position was not returned by ER:LC.';
        }

        return call;
    });

    return {
        ...payload,
        EmergencyCalls: normalizedCalls,
    };
}

function visibleCallSignature(payload: UnknownRecord): string {
    const calls = Array.isArray(payload.EmergencyCalls) ? payload.EmergencyCalls : [];
    return calls.map(call => {
        if (!isRecord(call)) return 'invalid';
        return [
            text(call.CallNumber ?? call.callNumber) || '?',
            text(call.StartedAt ?? call.startedAt) || '?',
            text(call.Caller ?? call.caller) || '?',
        ].join(':');
    }).join('|');
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

        const normalized = normalizeEmergencyPayload(payload);
        if (!normalized) return;
        const signature = visibleCallSignature(normalized);
        if (signature && signature !== lastVisibleCallSignature) {
            const rawCalls = Array.isArray(normalized.EmergencyCalls) ? normalized.EmergencyCalls : [];
            const playerCalls = rawCalls.filter(call => isRecord(call) && Boolean(callerId(call.Caller ?? call.caller))).length;
            logger.info(`[911 Poller] ER:LC currently reports ${rawCalls.length} emergency call(s), ${playerCalls} with a player caller.`);
            lastVisibleCallSignature = signature;
        } else if (!signature) {
            lastVisibleCallSignature = '';
        }

        if (Array.isArray(normalized.EmergencyCalls) && normalized.EmergencyCalls.length > 0) {
            await processIntegratedEmergencyCalls(client, normalized);
        }
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
    const delay = Math.max(250, nextAllowedAt - Date.now(), MIN_INTERVAL_MS);
    timer = setTimeout(async () => {
        await scan(client);
        schedule(client);
    }, delay);
}

export function startEmergencyDispatchHttpPoller(client: Client): void {
    if (timer) clearTimeout(timer);
    nextAllowedAt = 0;
    void scan(client).finally(() => schedule(client));
    logger.info('[911 Poller] HTTP emergency-call polling is active; Event Webhook is not required.');
}
