import { getMelonyApiKey, getMelonyApiUrl } from '../config/env';

const DEFAULT_MELONLY_API_URL = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USER_ENDPOINT = 'https://users.roblox.com/v1/users';
const DEFAULT_TIMEOUT_MS = 5_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface MelonlyRobloxProfile {
    discordId: string;
    robloxId: string;
    username: string | null;
    displayName: string | null;
}

export type MelonlyLookupResult =
    | { ok: true; status: 'ok'; profile: MelonlyRobloxProfile }
    | {
        ok: false;
        status: 'not_configured' | 'not_verified' | 'unauthorized' | 'rate_limited' | 'invalid_response' | 'unavailable';
        message: string;
    };

export interface MelonlyLookupOptions {
    apiKey?: string;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function configuredApiKey(explicit?: string): string {
    if (explicit !== undefined) return explicit.trim();
    return getMelonyApiKey()
        || process.env.MELONLY_API_TOKEN?.trim()
        || process.env.MELONLY_API_KEY?.trim()
        || '';
}

function configuredBaseUrl(explicit?: string): string {
    return (explicit || getMelonyApiUrl() || process.env.MELONLY_API_URL || DEFAULT_MELONLY_API_URL)
        .trim()
        .replace(/\/+$/, '');
}

async function fetchRobloxNames(
    robloxId: string,
    fetchImpl: FetchLike,
    signal: AbortSignal,
): Promise<{ username: string | null; displayName: string | null }> {
    try {
        const response = await fetchImpl(`${ROBLOX_USER_ENDPOINT}/${encodeURIComponent(robloxId)}`, {
            headers: { Accept: 'application/json' },
            signal,
        });
        if (!response.ok) return { username: null, displayName: null };
        const payload = await response.json().catch(() => null);
        if (!isRecord(payload)) return { username: null, displayName: null };
        return {
            username: nonEmptyString(payload.name),
            displayName: nonEmptyString(payload.displayName),
        };
    } catch {
        return { username: null, displayName: null };
    }
}

/** Resolve the Roblox account Melonly has linked to a Discord account. */
export async function resolveMelonlyRobloxProfile(
    discordUserId: string,
    options: MelonlyLookupOptions = {},
): Promise<MelonlyLookupResult> {
    if (!/^\d{17,20}$/.test(discordUserId)) {
        return { ok: false, status: 'invalid_response', message: 'The Discord user ID is invalid.' };
    }

    const apiKey = configuredApiKey(options.apiKey);
    if (!apiKey) {
        return { ok: false, status: 'not_configured', message: 'Melonly verification is not configured on this bot.' };
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(500, Math.floor(options.timeoutMs!))
        : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
        const response = await fetchImpl(
            `${configuredBaseUrl(options.baseUrl)}/verification/discord/${encodeURIComponent(discordUserId)}/roblox`,
            {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                signal: controller.signal,
            },
        );
        const payload = await response.json().catch(() => null);

        if (response.status === 401 || response.status === 403) {
            return { ok: false, status: 'unauthorized', message: 'The configured Melonly API token was rejected.' };
        }
        if (response.status === 404) {
            return { ok: false, status: 'not_verified', message: 'No Melonly-verified Roblox account is linked to this Discord user.' };
        }
        if (response.status === 429) {
            return { ok: false, status: 'rate_limited', message: 'Melonly is temporarily rate limited. Please try again shortly.' };
        }
        if (!response.ok || !isRecord(payload)) {
            return { ok: false, status: 'invalid_response', message: 'Melonly returned an invalid verification response.' };
        }

        const robloxId = nonEmptyString(payload.robloxId) || '';
        if (!/^\d+$/.test(robloxId)) {
            return { ok: false, status: 'invalid_response', message: 'Melonly did not return a valid Roblox user ID.' };
        }

        const names = await fetchRobloxNames(robloxId, fetchImpl, controller.signal);
        return {
            ok: true,
            status: 'ok',
            profile: {
                discordId: discordUserId,
                robloxId,
                username: names.username,
                displayName: names.displayName,
            },
        };
    } catch {
        return { ok: false, status: 'unavailable', message: 'Melonly could not be reached right now.' };
    } finally {
        clearTimeout(timer);
    }
}
