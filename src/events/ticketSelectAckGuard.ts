import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Legacy compatibility shim.
 *
 * Ticket interactions are now acknowledged exclusively by the Stable Router.
 * This function intentionally registers no InteractionCreate listener so
 * ticket:create-select cannot be deferred/replied to twice (Discord 40060).
 */
export function registerTicketSelectAckGuard(_client: Client): void {
    logger.info('[TicketAckGuard] DISABLED: StableRouter exclusively owns ticket:create-select acknowledgements.');
}
