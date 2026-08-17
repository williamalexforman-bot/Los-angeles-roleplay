import type { Client } from 'discord.js';
import {
    ERLC_SERVER_ENDPOINT,
    fetchErlcServer,
    type ErlcFetchResult,
} from './erlcService';
import { processIntegratedEmergencyCalls } from '../events/emergencyDispatchIntegrated';
import { logger } from '../utils/logger';

/**
 * Fetch one combined ER:LC v2 response for BOTH the normal ER:LC monitor and
 * 911 dispatch. EmergencyCalls are consumed directly from the raw successful
 * HTTP response so a validation problem in an unrelated logs/player section
 * cannot make a real 911 call disappear.
 */
export async function fetchErlcMonitorSnapshotWith911(
    client: Client,
    signal?: AbortSignal,
): Promise<ErlcFetchResult> {
    let emergencyPayload: unknown = null;
    let emergencyHttpOk = false;

    const result = await fetchErlcServer({
        signal,
        fetchImpl: async (_input, init) => {
            const url = new URL(ERLC_SERVER_ENDPOINT);
            url.searchParams.set('Players', 'true');
            url.searchParams.set('CommandLogs', 'true');
            url.searchParams.set('JoinLogs', 'true');
            url.searchParams.set('EmergencyCalls', 'true');

            const response = await fetch(url, init);
            emergencyHttpOk = response.ok;
            try {
                emergencyPayload = await response.clone().json();
            } catch {
                emergencyPayload = null;
            }
            return response;
        },
    });

    // Do not tie 911 detection to parseSnapshot(). The raw ER:LC response is
    // authoritative for EmergencyCalls even if another requested section is malformed.
    if (emergencyHttpOk && emergencyPayload) {
        try {
            await processIntegratedEmergencyCalls(client, emergencyPayload);
        } catch (error) {
            logger.warn(`[911 Integrated] Could not process emergency calls: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return result;
}
