import { loadPersistentSecret, savePersistentSecret } from './persistentSecretStore';

const DOCK_DISCORD_TO_ROBLOX_ENDPOINT = 'https://api.docksys.xyz/api/v1/public/discord-to-roblox';
const ROBLOX_USER_ENDPOINT = 'https://users.roblox.com/v1/users';
const DEFAULT_TIMEOUT_MS = 3_000;
let environmentKeyPersistenceAttempted = false;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface DockRobloxProfile {
    discordId: string;
    robloxId: string;
    username: string | null;
    displayName: string | null;
    createdAt: string | null;
    description: string | null;
    isBanned: boolean | null;
    hasVerifiedBadge: boolean | null;
}

export type DockLookupStatus =
    | 'ok'
    | 'not_configured'
    | 'not_verified'
    | 'not_in_guild'
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid_response'
    | 'unavailable';

export type DockLookupResult =
    | { ok: true; status: 'ok'; profile: DockRobloxProfile }
    | { ok: false; status: Exclude<DockLookupStatus, 'ok'>; message: string };

export interface DockLookupOptions {
    apiKey?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function failure(status: Exclude<DockLookupStatus, 'ok'>, message: string): DockLookupResult {
    return { ok: false, status, message };
}

interface RobloxProfileDetails {
    username: string | null;
    displayName: string | null;
    createdAt: string | null;
    description: string | null;
    isBanned: boolean | null;
    hasVerifiedBadge: boolean | null;
}

async function fetchRobloxProfile(
    robloxId: string,
    fetchImpl: FetchLike,
    signal: AbortSignal,
): Promise<RobloxProfileDetails> {
    const empty: RobloxProfileDetails = {
        username: null,
        displayName: null,
        createdAt: null,
        description: null,
        isBanned: null,
        hasVerifiedBadge: null,
    };
    try {
        const response = await fetchImpl(`${ROBLOX_USER_ENDPOINT}/${encodeURIComponent(robloxId)}`, {
            headers: { Accept: 'application/json' },
            signal,
        });
        if (!response.ok) return empty;
        const payload = await response.json().catch(() => null);
        if (!isRecord(payload)) return empty;
        return {
            username: text(payload.name),
            displayName: text(payload.displayName),
            createdAt: text(payload.created),
            description: text(payload.description),
            isBanned: bool(payload.isBanned),
            hasVerifiedBadge: bool(payload.hasVerifiedBadge),
        };
    } catch {
        return empty;
    }
}

async function configuredDockApiKey(explicit?: string): Promise<string> {
    if (explicit !== undefined) return explicit.trim();

    const environmentKey = (process.env.DOCK_API_KEY || '').trim();
    if (environmentKey) {
        if (!environmentKeyPersistenceAttempted) {
            environmentKeyPersistenceAttempted = true;
            void savePersistentSecret('DOCK_API_KEY', environmentKey).catch(() => false);
        }
        return environmentKey;
    }

    const persisted = (await loadPersistentSecret('DOCK_API_KEY').catch(() => null))?.trim() || '';
    if (persisted) process.env.DOCK_API_KEY = persisted;
    return persisted;
}

/**
 * Uses Dock as the authoritative Discord -> Roblox mapping for this guild.
 * The key is read from the environment first, then restored from encrypted
 * MongoDB persistence when the host has replaced its local filesystem.
 */
export async function resolveDockRobloxProfile(
    guildId: string,
    discordUserId: string,
    options: DockLookupOptions = {},
): Promise<DockLookupResult> {
    const apiKey = await configuredDockApiKey(options.apiKey);
    if (!apiKey) {
        return failure('not_configured', 'Dock verification is not configured on this bot.');
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
        const url = new URL(DOCK_DISCORD_TO_ROBLOX_ENDPOINT);
        url.searchParams.set('discordId', discordUserId);
        url.searchParams.set('guildId', guildId);
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
        });
        payload = await response.json().catch(() => null);
    } catch {
        clearTimeout(timer);
        return failure('unavailable', 'Dock could not be reached right now.');
    }

    if (response.status === 401) {
        clearTimeout(timer);
        return failure('unauthorized', 'The configured Dock API key was rejected.');
    }
    if (response.status === 403) {
        clearTimeout(timer);
        return failure('not_in_guild', 'Dock says this Discord user is not in the configured server.');
    }
    if (response.status === 404) {
        clearTimeout(timer);
        return failure('not_verified', 'No Dock-verified Roblox account is linked to this Discord user.');
    }
    if (response.status === 429) {
        clearTimeout(timer);
        return failure('rate_limited', 'Dock is temporarily rate limited.');
    }
    if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
        clearTimeout(timer);
        return failure('invalid_response', 'Dock returned an invalid verification response.');
    }

    const robloxIdValue = payload.data.robloxId;
    const robloxId = typeof robloxIdValue === 'number'
        ? String(Math.trunc(robloxIdValue))
        : text(robloxIdValue) || '';
    if (!/^\d+$/.test(robloxId)) {
        clearTimeout(timer);
        return failure('invalid_response', 'Dock did not return a valid Roblox user ID.');
    }

    let username: string | null = null;
    let displayName: string | null = null;
    if (isRecord(payload.resolved)) {
        username = text(payload.resolved.username);
        displayName = text(payload.resolved.displayName);
    }

    const details = await fetchRobloxProfile(robloxId, fetchImpl, controller.signal);
    clearTimeout(timer);

    return {
        ok: true,
        status: 'ok',
        profile: {
            discordId: discordUserId,
            robloxId,
            username: username || details.username,
            displayName: displayName || details.displayName,
            createdAt: details.createdAt,
            description: details.description,
            isBanned: details.isBanned,
            hasVerifiedBadge: details.hasVerifiedBadge,
        },
    };
}
