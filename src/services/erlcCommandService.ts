const ERLC_COMMAND_ENDPOINT = 'https://api.erlc.gg/v1/server/command';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 8_000;

type UnknownRecord = Record<string, unknown>;

export type ErlcCommandResult =
    | { ok: true; message: string }
    | {
        ok: false;
        status: number | null;
        code: number | null;
        message: string;
        retryAfterMs: number | null;
    };

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function retryAfterMilliseconds(response: Response, payload: UnknownRecord | null): number | null {
    const bodySeconds = finiteNumber(payload?.retry_after);
    if (bodySeconds !== null && bodySeconds >= 0) return Math.ceil(bodySeconds * 1_000);

    const header = response.headers.get('retry-after');
    if (!header) return null;
    const headerSeconds = Number(header);
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return Math.ceil(headerSeconds * 1_000);
    return null;
}

function errorMessage(code: number | null, apiMessage: string | null, status: number): string {
    const known: Record<number, string> = {
        0: 'ER:LC reported an unknown server error.',
        1001: 'ER:LC could not communicate with Roblox or the in-game private server.',
        1002: 'ER:LC reported an internal API error.',
        2000: 'The ER:LC server key was not sent.',
        2001: 'The configured ER:LC server key is formatted incorrectly.',
        2002: 'The configured ER:LC server key is invalid or expired.',
        2003: 'The configured ER:LC global API key is invalid.',
        2004: 'The ER:LC server key is currently blocked from API access.',
        3001: 'ER:LC rejected the input because it is not a valid private-server command.',
        3002: 'The ER:LC private server is offline or currently has no players.',
        4001: 'The ER:LC command route is temporarily rate limited.',
        4002: 'That ER:LC command is restricted and cannot be run through the API.',
        4003: 'ER:LC blocked the message or command content.',
        9998: 'That ER:LC API resource is restricted.',
        9999: 'The ER:LC in-game API module is out of date.',
    };
    if (code !== null && known[code]) return known[code];
    if (apiMessage) return apiMessage.slice(0, 300);
    return `ER:LC returned HTTP ${status}.`;
}

async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function attemptCommand(command: string, serverKey: string, timeoutMs: number): Promise<ErlcCommandResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(ERLC_COMMAND_ENDPOINT, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'server-key': serverKey,
            },
            body: JSON.stringify({ command }),
            signal: controller.signal,
        });
        const raw = await response.json().catch(() => null);
        const payload = isRecord(raw) ? raw : null;
        const codeValue = finiteNumber(payload?.code);
        const code = codeValue === null ? null : Math.trunc(codeValue);
        const apiMessage = text(payload?.message);
        const retryAfterMs = retryAfterMilliseconds(response, payload);

        if (response.ok && code === null) {
            return { ok: true, message: apiMessage || 'Success' };
        }

        return {
            ok: false,
            status: response.status,
            code,
            message: errorMessage(code, apiMessage, response.status),
            retryAfterMs,
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            code: null,
            message: error instanceof Error && error.name === 'AbortError'
                ? 'The ER:LC command request timed out.'
                : 'The ER:LC command endpoint could not be reached.',
            retryAfterMs: null,
        };
    } finally {
        clearTimeout(timer);
    }
}

/** Runs a virtual server-management command and retries one command-bucket rate limit. */
export async function runErlcCommand(commandInput: string): Promise<ErlcCommandResult> {
    const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
    if (!serverKey) {
        return {
            ok: false,
            status: null,
            code: 2000,
            message: 'The ER:LC server key is not configured on this bot.',
            retryAfterMs: null,
        };
    }

    const entered = commandInput.trim();
    const command = entered.startsWith(':') ? entered : `:${entered}`;
    if (command.length < 2) {
        return {
            ok: false,
            status: null,
            code: 3001,
            message: 'Enter a valid ER:LC private-server command.',
            retryAfterMs: null,
        };
    }

    let result = await attemptCommand(command, serverKey, DEFAULT_TIMEOUT_MS);
    if (!result.ok && (result.status === 429 || result.code === 4001)) {
        const waitMs = result.retryAfterMs;
        if (waitMs !== null && waitMs >= 0 && waitMs <= MAX_RETRY_WAIT_MS) {
            await sleep(Math.max(250, waitMs + 100));
            result = await attemptCommand(command, serverKey, DEFAULT_TIMEOUT_MS);
        }
    }
    return result;
}
