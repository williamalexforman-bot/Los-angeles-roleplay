const DOCK_ROBLOX_TO_DISCORD_ENDPOINT = 'https://api.docksys.xyz/api/v1/public/roblox-to-discord';
const DEFAULT_TIMEOUT_MS = 2_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export type DockReverseLookupResult =
    | { ok: true; discordIds: string[] }
    | {
        ok: false;
        status: 'not_configured' | 'not_verified' | 'unauthorized' | 'rate_limited' | 'invalid_response' | 'unavailable';
        message: string;
    };

export interface DockReverseLookupOptions {
    apiKey?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function resolveDockDiscordIds(
    guildId: string,
    robloxId: string,
    options: DockReverseLookupOptions = {},
): Promise<DockReverseLookupResult> {
    const apiKey = (options.apiKey ?? process.env.DOCK_API_KEY ?? '').trim();
    if (!apiKey) {
        return { ok: false, status: 'not_configured', message: 'Dock API key is not configured.' };
    }
    if (!/^\d+$/.test(robloxId)) {
        return { ok: false, status: 'invalid_response', message: 'A valid Roblox ID was not supplied.' };
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(500, Math.floor(options.timeoutMs!))
        : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
        const url = new URL(DOCK_ROBLOX_TO_DISCORD_ENDPOINT);
        url.searchParams.set('robloxId', robloxId);
        url.searchParams.set('guildId', guildId);

        const response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        if (response.status === 401 || response.status === 403) {
            return { ok: false, status: 'unauthorized', message: 'Dock rejected the configured API key or guild.' };
        }
        if (response.status === 404) {
            return { ok: false, status: 'not_verified', message: 'No Dock link exists for that Roblox account.' };
        }
        if (response.status === 429) {
            return { ok: false, status: 'rate_limited', message: 'Dock is temporarily rate limited.' };
        }
        if (!response.ok || !isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.discordIds)) {
            return { ok: false, status: 'invalid_response', message: 'Dock returned an invalid reverse lookup response.' };
        }

        const discordIds = Array.from(new Set(
            payload.data.discordIds
                .map(value => typeof value === 'number' ? String(Math.trunc(value)) : String(value || '').trim())
                .filter(value => /^\d+$/.test(value)),
        ));

        if (!discordIds.length) {
            return { ok: false, status: 'not_verified', message: 'No Discord account is linked to that Roblox account.' };
        }

        return { ok: true, discordIds };
    } catch {
        return { ok: false, status: 'unavailable', message: 'Dock could not be reached.' };
    } finally {
        clearTimeout(timer);
    }
}
