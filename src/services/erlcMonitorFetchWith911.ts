import type { Client } from 'discord.js';
import {
    ERLC_SERVER_ENDPOINT,
    fetchErlcServer,
    type ErlcFetchResult,
} from './erlcService';

/**
 * Fetch the normal ER:LC monitoring snapshot.
 *
 * 911 emergency calls are intentionally NOT requested here anymore. They are
 * owned by the dedicated emergency-call poller so the bot never has two
 * competing consumers posting the same call or unnecessarily spending the
 * same ER:LC rate-limit budget.
 */
export async function fetchErlcMonitorSnapshotWith911(
    _client: Client,
    signal?: AbortSignal,
): Promise<ErlcFetchResult> {
    return fetchErlcServer({
        signal,
        fetchImpl: async (_input, init) => {
            const url = new URL(ERLC_SERVER_ENDPOINT);
            url.searchParams.set('Players', 'true');
            url.searchParams.set('CommandLogs', 'true');
            url.searchParams.set('JoinLogs', 'true');
            return fetch(url, init);
        },
    });
}
