const BLOXLINK_API_BASE = 'https://api.blox.link/v4/public/guilds';
const DEFAULT_TIMEOUT_MS = 1_500;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export type BloxlinkLookupFailureStatus =
    | 'not_configured'
    | 'not_verified'
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid_response'
    | 'unavailable';

export interface BloxlinkLookupSuccess {
    ok: true;
    robloxId: string;
}

export interface BloxlinkLookupFailure {
    ok: false;
    status: BloxlinkLookupFailureStatus;
    message: string;
}

export type BloxlinkLookupResult = BloxlinkLookupSuccess | BloxlinkLookupFailure;

export interface BloxlinkLookupOptions {
    apiKey?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(status: BloxlinkLookupFailureStatus, message: string): BloxlinkLookupFailure {
    return { ok: false, status, message };
}

/**
 * Resolves the Roblox account Bloxlink has verified for a Discord member in a
 * specific Discord server. No second Discord-to-Roblox mapping is stored by
 * this bot, so Bloxlink remains the single source of truth.
 */
export async function resolveBloxlinkRobloxId(
    guildId: string,
    discordUserId: string,
    options: BloxlinkLookupOptions = {},
): Promise<BloxlinkLookupResult> {
    const apiKey = (options.apiKey ?? process.env.BLOXLINK_API_KEY ?? '').trim();
    if (!apiKey) {
        return failure('not_configured', 'Bloxlink verification is not configured on this bot.');
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(500, Math.floor(options.timeoutMs!))
        : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? fetch;

    let response: Response;
    let payload: unknown = null;
    try {
        const url = `${BLOXLINK_API_BASE}/${encodeURIComponent(guildId)}/discord-to-roblox/${encodeURIComponent(discordUserId)}`;
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: apiKey,
            },
            signal: controller.signal,
        });
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
    } catch {
        return failure('unavailable', 'Bloxlink could not be reached right now.');
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 404) {
        return failure('not_verified', 'No Bloxlink-verified Roblox account was found for this Discord user.');
    }
    if (response.status === 401 || response.status === 403) {
        return failure('unauthorized', 'The configured Bloxlink API key was rejected.');
    }
    if (response.status === 429) {
        return failure('rate_limited', 'Bloxlink is temporarily rate limited.');
    }
    if (!response.ok) {
        return failure('unavailable', `Bloxlink returned HTTP ${response.status}.`);
    }

    const robloxIdValue = isRecord(payload) ? payload.robloxID : null;
    const robloxId = typeof robloxIdValue === 'number'
        ? String(Math.trunc(robloxIdValue))
        : typeof robloxIdValue === 'string'
            ? robloxIdValue.trim()
            : '';
    if (!/^\d+$/.test(robloxId)) {
        return failure('invalid_response', 'Bloxlink returned an invalid Roblox account ID.');
    }

    return { ok: true, robloxId };
}
