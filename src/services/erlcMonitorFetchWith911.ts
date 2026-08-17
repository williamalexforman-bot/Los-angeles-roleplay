import type { Client } from 'discord.js';
import {
    ERLC_SERVER_ENDPOINT,
    fetchErlcServer,
    type ErlcFetchResult,
} from './erlcService';
import { processIntegratedEmergencyCalls } from '../events/emergencyDispatchIntegrated';
import { logger } from '../utils/logger';

/**
 * Fetch one combined ER:LC v2 snapshot for BOTH the normal ER:LC monitor and
 * 911 dispatch. This deliberately avoids a second emergency-call poller so
 * short player-made 911 calls do not get lost behind a competing rate limit.
 */
export async function fetchErlcMonitorSnapshotWith911(
    client: Client,
    signal?: AbortSignal,
): Promise<ErlcFetchResult> {
    let emergencyPayload: unknown = null;

    const result = await fetchErlcServer({
        signal,
        fetchImpl: async (_input, init) => {
            const url = new URL(ERLC_SERVER_ENDPOINT);
            url.searchParams.set('Players', 'true');
            url.searchParams.set('CommandLogs', 'true');
            url.searchParams.set('JoinLogs', 'true');
            url.searchParams.set('EmergencyCalls', 'true');

            const response = await fetch(url, init);
            try {
                emergencyPayload = await response.clone().json();
            } catch {
                emergencyPayload = null;
            }
            return response;
        },
    });

    if (result.ok && emergencyPayload) {
        try {
            await processIntegratedEmergencyCalls(client, emergencyPayload);
        } catch (error) {
            // A Discord 911-panel failure must never break command/team monitoring.
            logger.warn(`[911 Integrated] Could not process emergency calls: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return result;
}
