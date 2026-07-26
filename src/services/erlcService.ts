import { createHash } from 'crypto';

export const ERLC_SERVER_ENDPOINT = 'https://api.erlc.gg/v2/server';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_MS = 30_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface ErlcIdentity {
    raw: string;
    name: string;
    robloxId: string | null;
}

export interface ErlcPlayer {
    player: ErlcIdentity;
    team: string;
    permission: string;
    callsign: string | null;
    wantedStars: number | null;
}

export interface ErlcCommandLog {
    id: string;
    player: ErlcIdentity;
    timestamp: number;
    command: string;
}

export interface ErlcJoinLog {
    id: string;
    player: ErlcIdentity;
    timestamp: number;
    joined: boolean;
}

export interface ErlcServerSnapshot {
    name: string;
    ownerId: string | null;
    coOwnerIds: string[];
    currentPlayers: number;
    maxPlayers: number;
    joinKey: string | null;
    accountVerificationRequirement: string | null;
    teamBalance: boolean | null;
    players: ErlcPlayer[];
    commandLogs: ErlcCommandLog[];
    joinLogs: ErlcJoinLog[];
    fetchedAt: number;
}

export interface ErlcRateLimitInfo {
    bucket: string | null;
    limit: number | null;
    remaining: number | null;
    resetAt: number | null;
    retryAfterMs: number | null;
}

export interface ErlcFetchSuccess {
    ok: true;
    status: 'ok';
    data: ErlcServerSnapshot;
    rateLimit: ErlcRateLimitInfo;
    nextRequestAt: number;
}

export type ErlcFetchFailureKind =
    | 'not_configured'
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid_response'
    | 'unavailable';

export interface ErlcFetchFailure {
    ok: false;
    status: ErlcFetchFailureKind;
    message: string;
    httpStatus?: number;
    apiCode?: number;
    rateLimit: ErlcRateLimitInfo;
    retryAfterMs: number;
    nextRequestAt: number;
}

export type ErlcFetchResult = ErlcFetchSuccess | ErlcFetchFailure;

export interface ErlcFetchOptions {
    serverKey?: string;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function integerHeader(value: string | null): number | null {
    if (value === null || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function epochToMilliseconds(value: unknown): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed < 0) return null;
    return parsed >= 1_000_000_000_000 ? Math.floor(parsed) : Math.floor(parsed * 1_000);
}

function timestampToSeconds(value: unknown): number {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed < 0) return 0;
    return Math.floor(parsed >= 1_000_000_000_000 ? parsed / 1_000 : parsed);
}

function parseRetryAfterHeader(value: string | null): number | null {
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

    const parsedDate = Date.parse(value);
    return Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : null;
}

export function parseErlcIdentity(value: unknown): ErlcIdentity {
    const raw = typeof value === 'string'
        ? value.trim()
        : typeof value === 'number'
            ? String(value)
            : '';
    if (!raw) return { raw: '', name: 'Unknown', robloxId: null };

    const separator = raw.lastIndexOf(':');
    if (separator <= 0 || separator === raw.length - 1) {
        return { raw, name: raw, robloxId: null };
    }

    const name = raw.slice(0, separator).trim();
    const possibleId = raw.slice(separator + 1).trim();
    if (!name || !/^\d+$/.test(possibleId)) {
        return { raw, name: raw, robloxId: null };
    }

    return { raw, name, robloxId: possibleId };
}

export function createErlcLogFingerprint(
    type: 'command' | 'join',
    timestamp: number,
    playerRaw: string,
    detail: string,
): string {
    return createHash('sha256')
        .update(`${type}\u0000${timestamp}\u0000${playerRaw}\u0000${detail}`)
        .digest('hex')
        .slice(0, 32);
}

function parsePlayer(value: unknown): ErlcPlayer | null {
    if (!isRecord(value)) return null;
    const player = parseErlcIdentity(value.Player);
    const team = optionalString(value.Team);
    const permission = optionalString(value.Permission);
    if (!player.raw || !team || !permission) return null;

    return {
        player,
        team,
        permission,
        callsign: optionalString(value.Callsign),
        wantedStars: finiteNumber(value.WantedStars),
    };
}

function parseCommandLog(value: unknown): ErlcCommandLog | null {
    if (!isRecord(value)) return null;
    const player = parseErlcIdentity(value.Player);
    const command = optionalString(value.Command);
    const timestamp = timestampToSeconds(value.Timestamp);
    if (!player.raw || !command || timestamp === 0) return null;

    return {
        id: createErlcLogFingerprint('command', timestamp, player.raw, command),
        player,
        timestamp,
        command,
    };
}

function parseJoinLog(value: unknown): ErlcJoinLog | null {
    if (!isRecord(value)) return null;
    const player = parseErlcIdentity(value.Player);
    const timestamp = timestampToSeconds(value.Timestamp);
    if (!player.raw || timestamp === 0 || typeof value.Join !== 'boolean') return null;

    return {
        id: createErlcLogFingerprint('join', timestamp, player.raw, value.Join ? 'join' : 'leave'),
        player,
        timestamp,
        joined: value.Join,
    };
}

function parseSnapshot(value: unknown): ErlcServerSnapshot | null {
    if (!isRecord(value)) return null;

    const name = optionalString(value.Name);
    const currentPlayers = finiteNumber(value.CurrentPlayers);
    const maxPlayers = finiteNumber(value.MaxPlayers);
    if (!name || currentPlayers === null || maxPlayers === null) return null;

    // These fields were explicitly requested in the query. Treat partial data as invalid so
    // the monitor never mistakes a malformed response for players leaving or changing teams.
    if (!Array.isArray(value.Players) || !Array.isArray(value.CommandLogs) || !Array.isArray(value.JoinLogs)) {
        return null;
    }
    const parsedPlayers = value.Players.map(parsePlayer);
    const parsedCommandLogs = value.CommandLogs.map(parseCommandLog);
    const parsedJoinLogs = value.JoinLogs.map(parseJoinLog);
    if (
        parsedPlayers.some(item => item === null)
        || parsedCommandLogs.some(item => item === null)
        || parsedJoinLogs.some(item => item === null)
    ) {
        return null;
    }
    const players = parsedPlayers as ErlcPlayer[];
    const commandLogs = parsedCommandLogs as ErlcCommandLog[];
    const joinLogs = parsedJoinLogs as ErlcJoinLog[];

    const possibleOwnerId = typeof value.OwnerId === 'string' || typeof value.OwnerId === 'number'
        ? String(value.OwnerId)
        : '';
    const ownerId = /^\d+$/.test(possibleOwnerId) ? possibleOwnerId : null;
    const coOwnerIds = Array.isArray(value.CoOwnerIds)
        ? value.CoOwnerIds
            .filter(item => typeof item === 'number' || typeof item === 'string')
            .map(String)
            .filter(item => /^\d+$/.test(item))
        : [];

    return {
        name,
        ownerId,
        coOwnerIds,
        currentPlayers: Math.max(0, Math.floor(currentPlayers)),
        maxPlayers: Math.max(0, Math.floor(maxPlayers)),
        joinKey: optionalString(value.JoinKey),
        accountVerificationRequirement: optionalString(value.AccVerifiedReq),
        teamBalance: typeof value.TeamBalance === 'boolean' ? value.TeamBalance : null,
        players,
        commandLogs,
        joinLogs,
        fetchedAt: Date.now(),
    };
}

function parseRateLimit(response?: Response, bodyRetryAfter?: unknown): ErlcRateLimitInfo {
    if (!response) {
        return { bucket: null, limit: null, remaining: null, resetAt: null, retryAfterMs: null };
    }

    const bodySeconds = finiteNumber(bodyRetryAfter);
    const bodyRetryMs = bodySeconds !== null && bodySeconds >= 0 ? Math.ceil(bodySeconds * 1_000) : null;
    return {
        bucket: optionalString(response.headers.get('x-ratelimit-bucket')),
        limit: integerHeader(response.headers.get('x-ratelimit-limit')),
        remaining: integerHeader(response.headers.get('x-ratelimit-remaining')),
        resetAt: epochToMilliseconds(response.headers.get('x-ratelimit-reset')),
        retryAfterMs: bodyRetryMs ?? parseRetryAfterHeader(response.headers.get('retry-after')),
    };
}

export function calculateErlcRetryDelay(rateLimit: ErlcRateLimitInfo, fallbackMs = DEFAULT_RETRY_MS): number {
    if (rateLimit.retryAfterMs !== null) return Math.max(1_000, rateLimit.retryAfterMs);
    if (rateLimit.remaining === 0 && rateLimit.resetAt !== null) {
        return Math.max(1_000, rateLimit.resetAt - Date.now() + 250);
    }
    return Math.max(1_000, fallbackMs);
}

function withTimeout(timeoutMs: number, externalSignal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const safeTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.max(250, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs)))
        : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
    const abortFromExternal = () => controller.abort();

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', abortFromExternal);
        },
    };
}

function failure(
    status: ErlcFetchFailureKind,
    message: string,
    rateLimit: ErlcRateLimitInfo,
    extra: Pick<ErlcFetchFailure, 'httpStatus' | 'apiCode'> = {},
    fallbackRetryMs = DEFAULT_RETRY_MS,
): ErlcFetchFailure {
    const retryAfterMs = calculateErlcRetryDelay(rateLimit, fallbackRetryMs);
    return {
        ok: false,
        status,
        message,
        rateLimit,
        retryAfterMs,
        nextRequestAt: Date.now() + retryAfterMs,
        ...extra,
    };
}

/** Fetches the requested combined ER:LC v2 server snapshot without exposing the server key. */
export async function fetchErlcServer(options: ErlcFetchOptions = {}): Promise<ErlcFetchResult> {
    const serverKey = (options.serverKey ?? process.env.ERLC_SERVER_KEY ?? '').trim();
    const emptyRateLimit = parseRateLimit();
    if (!serverKey) {
        return failure(
            'not_configured',
            'ER:LC monitoring is not configured.',
            emptyRateLimit,
            {},
            300_000,
        );
    }

    const url = new URL(ERLC_SERVER_ENDPOINT);
    url.searchParams.set('Players', 'true');
    url.searchParams.set('CommandLogs', 'true');
    url.searchParams.set('JoinLogs', 'true');

    const fetchImpl = options.fetchImpl ?? fetch;
    const timeout = withTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
    let response: Response;
    let payload: unknown = null;

    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'server-key': serverKey,
            },
            signal: timeout.signal,
        });
        try {
            payload = await response.json();
        } catch {
            // Invalid JSON is classified below without including response content.
        }
    } catch {
        return failure('unavailable', 'The ER:LC API is temporarily unavailable.', emptyRateLimit);
    } finally {
        timeout.cleanup();
    }

    const payloadRecord = isRecord(payload) ? payload : null;
    const rateLimit = parseRateLimit(response, payloadRecord?.retry_after);
    const apiCodeValue = finiteNumber(payloadRecord?.code);
    const apiCode = apiCodeValue === null ? undefined : Math.floor(apiCodeValue);

    if (response.status === 429 || apiCode === 4001) {
        return failure('rate_limited', 'The ER:LC API rate limit was reached.', rateLimit, {
            httpStatus: response.status,
            apiCode,
        });
    }

    if (response.status === 401 || response.status === 403 || (apiCode !== undefined && apiCode >= 2000 && apiCode <= 2004)) {
        return failure(
            'unauthorized',
            'ER:LC monitoring is unavailable because authentication failed.',
            rateLimit,
            { httpStatus: response.status, apiCode },
            900_000,
        );
    }

    if (!response.ok) {
        return failure('unavailable', 'The ER:LC API is temporarily unavailable.', rateLimit, {
            httpStatus: response.status,
            apiCode,
        });
    }

    const data = parseSnapshot(payload);
    if (!data) {
        return failure('invalid_response', 'The ER:LC API returned an invalid server snapshot.', rateLimit, {
            httpStatus: response.status,
        });
    }

    const delay = rateLimit.remaining === 0
        ? calculateErlcRetryDelay(rateLimit)
        : 0;
    return {
        ok: true,
        status: 'ok',
        data,
        rateLimit,
        nextRequestAt: Date.now() + delay,
    };
}

export const fetchErlcServerSnapshot = fetchErlcServer;
