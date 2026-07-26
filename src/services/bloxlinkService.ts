import { getBloxlinkApiKey } from '../config/env';

const BLOXLINK_API_BASE = 'https://api.blox.link/v4/public';
const ROBLOX_USERS_API_BASE = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMBNAILS_ENDPOINT = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MINIMUM_INTERVAL_MS = 2_500;
const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;
const MAX_THROTTLE_ENTRIES = 5_000;

const activeLookups = new Set<string>();
const lastLookupAt = new Map<string, number>();
let bloxlinkRetryNotBefore = 0;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type BloxlinkUnavailableReason =
    | 'not_configured'
    | 'invalid_request'
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid_response'
    | 'network_error';

interface BloxlinkBaseResult {
    verified: boolean;
    robloxId: string | null;
    robloxUsername: string | null;
    robloxDisplayName: string | null;
    robloxAvatarUrl: string | null;
    robloxCreatedAt: string | null;
    profileUrl: string | null;
    verificationSource: 'Bloxlink';
}

export interface BloxlinkVerifiedResult extends BloxlinkBaseResult {
    status: 'verified';
    verified: true;
    robloxId: string;
    profileUrl: string;
    warnings: string[];
}

export interface BloxlinkNotVerifiedResult extends BloxlinkBaseResult {
    status: 'not_verified';
    verified: false;
    message: 'No verified Roblox account found';
}

export interface BloxlinkUnavailableResult extends BloxlinkBaseResult {
    status: 'service_unavailable';
    verified: false;
    reason: BloxlinkUnavailableReason;
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
}

export type BloxlinkLookupResult =
    | BloxlinkVerifiedResult
    | BloxlinkNotVerifiedResult
    | BloxlinkUnavailableResult;

export interface BloxlinkLookupOptions {
    apiKey?: string;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    minimumIntervalMs?: number;
}

interface RobloxProfilePayload {
    id?: number | string;
    name?: string;
    displayName?: string;
    created?: string;
}

interface RobloxThumbnailPayload {
    data?: Array<{
        targetId?: number | string;
        state?: string;
        imageUrl?: string;
    }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRobloxProfile(value: unknown, expectedId: string): RobloxProfilePayload | null {
    if (!isRecord(value)) return null;
    const returnedId = typeof value.id === 'string' || typeof value.id === 'number'
        ? String(value.id)
        : '';
    if (returnedId !== expectedId || typeof value.name !== 'string' || typeof value.displayName !== 'string') {
        return null;
    }

    return {
        id: returnedId,
        name: value.name,
        displayName: value.displayName,
        created: typeof value.created === 'string' ? value.created : undefined,
    };
}

function emptyIdentity(): BloxlinkBaseResult & { verified: false } {
    return {
        verified: false,
        robloxId: null,
        robloxUsername: null,
        robloxDisplayName: null,
        robloxAvatarUrl: null,
        robloxCreatedAt: null,
        profileUrl: null,
        verificationSource: 'Bloxlink',
    };
}

function unavailable(
    reason: BloxlinkUnavailableReason,
    message: string,
    extra: Pick<BloxlinkUnavailableResult, 'httpStatus' | 'retryAfterMs'> = {},
): BloxlinkUnavailableResult {
    return {
        ...emptyIdentity(),
        status: 'service_unavailable',
        reason,
        message,
        ...extra,
    };
}

function notVerified(): BloxlinkNotVerifiedResult {
    return {
        ...emptyIdentity(),
        status: 'not_verified',
        message: 'No verified Roblox account found',
    };
}

function isDiscordSnowflake(value: string): boolean {
    return /^\d{16,22}$/.test(value);
}

function parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return undefined;
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

async function fetchOptionalJson<T>(
    fetchImpl: FetchLike,
    url: string,
    timeoutMs: number,
    externalSignal?: AbortSignal,
): Promise<T | null> {
    const request = withTimeout(timeoutMs, externalSignal);
    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: request.signal,
        });
        if (!response.ok) return null;
        return await response.json() as T;
    } catch {
        return null;
    } finally {
        request.cleanup();
    }
}

/**
 * Resolves a Discord member to Roblox through Bloxlink's v4 Server API, then
 * enriches the verified ID with Roblox's public profile and headshot APIs.
 * No nickname-based fallback is attempted.
 */
async function performBloxlinkLookup(
    guildId: string,
    discordUserId: string,
    options: BloxlinkLookupOptions = {},
): Promise<BloxlinkLookupResult> {
    if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId)) {
        return unavailable('invalid_request', 'A valid Discord guild ID and user ID are required.');
    }

    const apiKey = options.apiKey === undefined
        ? getBloxlinkApiKey() ?? ''
        : options.apiKey.trim();
    if (!apiKey) {
        return unavailable('not_configured', 'Bloxlink verification is not configured.');
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const request = withTimeout(timeoutMs, options.signal);

    let response: Response;
    let payload: unknown = null;
    let invalidJson = false;
    try {
        const url = `${BLOXLINK_API_BASE}/guilds/${guildId}/discord-to-roblox/${discordUserId}`;
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: apiKey,
            },
            signal: request.signal,
        });
        if (response.ok) {
            try {
                payload = await response.json();
            } catch {
                invalidJson = true;
            }
        }
    } catch {
        return unavailable('network_error', 'Bloxlink verification is temporarily unavailable.');
    } finally {
        request.cleanup();
    }

    if (response.status === 404) return notVerified();
    if (response.status === 401 || response.status === 403) {
        return unavailable('unauthorized', 'Bloxlink verification is unavailable because authentication failed.', {
            httpStatus: response.status,
        });
    }
    if (response.status === 429) {
        return unavailable('rate_limited', 'Bloxlink verification is temporarily rate limited.', {
            httpStatus: response.status,
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        });
    }
    if (!response.ok) {
        return unavailable('network_error', 'Bloxlink verification is temporarily unavailable.', {
            httpStatus: response.status,
        });
    }

    if (invalidJson) {
        return unavailable('invalid_response', 'Bloxlink returned an invalid response.');
    }

    if (!payload || typeof payload !== 'object') {
        return unavailable('invalid_response', 'Bloxlink returned an invalid response.');
    }

    const rawRobloxId = (payload as Record<string, unknown>).robloxID;
    const robloxId = typeof rawRobloxId === 'string' || typeof rawRobloxId === 'number'
        ? String(rawRobloxId)
        : '';

    if (!/^\d+$/.test(robloxId)) {
        return unavailable('invalid_response', 'Bloxlink did not return a valid Roblox account ID.');
    }

    const profileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
    const thumbnailUrl = new URL(ROBLOX_THUMBNAILS_ENDPOINT);
    thumbnailUrl.searchParams.set('userIds', robloxId);
    thumbnailUrl.searchParams.set('size', '420x420');
    thumbnailUrl.searchParams.set('format', 'Png');
    thumbnailUrl.searchParams.set('isCircular', 'false');

    const [rawProfile, rawThumbnail] = await Promise.all([
        fetchOptionalJson<unknown>(
            fetchImpl,
            `${ROBLOX_USERS_API_BASE}/${robloxId}`,
            timeoutMs,
            options.signal,
        ),
        fetchOptionalJson<unknown>(
            fetchImpl,
            thumbnailUrl.toString(),
            timeoutMs,
            options.signal,
        ),
    ]);

    const profile = parseRobloxProfile(rawProfile, robloxId);
    const thumbnail = isRecord(rawThumbnail) ? rawThumbnail as RobloxThumbnailPayload : null;
    const warnings: string[] = [];
    if (!profile) warnings.push('Roblox profile details are temporarily unavailable.');

    const thumbnailEntries = Array.isArray(thumbnail?.data)
        ? thumbnail.data.filter(item => isRecord(item))
        : [];
    const thumbnailEntry = thumbnailEntries.find(item => String(item.targetId) === robloxId);
    const avatarUrl = typeof thumbnailEntry?.imageUrl === 'string' && thumbnailEntry.imageUrl.length > 0
        ? thumbnailEntry.imageUrl
        : null;
    if (!avatarUrl) warnings.push('Roblox avatar is temporarily unavailable.');

    const createdAt = typeof profile?.created === 'string' && Number.isFinite(Date.parse(profile.created))
        ? profile.created
        : null;

    return {
        status: 'verified',
        verified: true,
        robloxId,
        robloxUsername: typeof profile?.name === 'string' ? profile.name : null,
        robloxDisplayName: typeof profile?.displayName === 'string' ? profile.displayName : null,
        robloxAvatarUrl: avatarUrl,
        robloxCreatedAt: createdAt,
        profileUrl,
        verificationSource: 'Bloxlink',
        warnings,
    };
}

function boundedMinimumInterval(value: number | undefined): number {
    if (value === undefined) return DEFAULT_MINIMUM_INTERVAL_MS;
    if (!Number.isFinite(value)) return DEFAULT_MINIMUM_INTERVAL_MS;
    return Math.max(0, Math.min(60_000, Math.floor(value)));
}

function rememberLookup(key: string, at: number): void {
    lastLookupAt.delete(key);
    lastLookupAt.set(key, at);
    if (lastLookupAt.size <= MAX_THROTTLE_ENTRIES) return;
    const oldestKey = lastLookupAt.keys().next().value as string | undefined;
    if (oldestKey) lastLookupAt.delete(oldestKey);
}

/** Production wrapper that prevents concurrent/rapid refreshes from amplifying API usage. */
export async function lookupBloxlinkUser(
    guildId: string,
    discordUserId: string,
    options: BloxlinkLookupOptions = {},
): Promise<BloxlinkLookupResult> {
    // Injected fetches are deterministic test/custom transports and manage their own request policy.
    const throttleEnabled = options.fetchImpl === undefined;
    const configuredKey = options.apiKey === undefined
        ? getBloxlinkApiKey() ?? ''
        : options.apiKey.trim();
    if (!throttleEnabled || !configuredKey || !isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId)) {
        return performBloxlinkLookup(guildId, discordUserId, options);
    }

    const now = Date.now();
    if (now < bloxlinkRetryNotBefore) {
        return unavailable('rate_limited', 'Bloxlink verification is temporarily rate limited.', {
            retryAfterMs: bloxlinkRetryNotBefore - now,
        });
    }

    const lookupKey = `${guildId}:${discordUserId}`;
    const minimumIntervalMs = boundedMinimumInterval(options.minimumIntervalMs);
    const lastStartedAt = lastLookupAt.get(lookupKey) ?? 0;
    if (activeLookups.has(lookupKey) || now - lastStartedAt < minimumIntervalMs) {
        return unavailable('rate_limited', 'Please wait briefly before refreshing Roblox information again.', {
            retryAfterMs: activeLookups.has(lookupKey)
                ? minimumIntervalMs
                : Math.max(1, minimumIntervalMs - (now - lastStartedAt)),
        });
    }

    activeLookups.add(lookupKey);
    rememberLookup(lookupKey, now);
    try {
        const result = await performBloxlinkLookup(guildId, discordUserId, options);
        if (result.status === 'service_unavailable' && result.reason === 'rate_limited') {
            const retryAfterMs = result.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS;
            bloxlinkRetryNotBefore = Math.max(bloxlinkRetryNotBefore, Date.now() + retryAfterMs);
        }
        return result;
    } finally {
        activeLookups.delete(lookupKey);
    }
}

export const getBloxlinkUser = lookupBloxlinkUser;
