import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

// Startup REST repair is intentionally disabled. The Render shared egress IP
// has been receiving Discord/Cloudflare HTTP 429 responses, and repeatedly
// fetching/deleting/recreating commands during every deployment makes that
// worse. Existing Discord registrations are preserved until an explicit manual
// command-sync maintenance action is performed.
export async function forceRepairActivityCheckCommand(_client: Client): Promise<void> {
    logger.warn('[ActivityCheckRepair] Skipped automatic REST repair to avoid Discord 429 rate limits.');
}
