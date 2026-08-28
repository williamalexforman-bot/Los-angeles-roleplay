import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Ticket-select acknowledgement is handled synchronously inside the stable
 * interaction router. Keeping a separate InteractionCreate listener here
 * creates a race because EventEmitter does not await async listeners.
 */
export function registerTicketSelectAckGuard(_client: Client): void {
    logger.info('[TicketAckGuard] ROUTER-OWNED: ticket:create-select acknowledgement is handled synchronously by StableRouter.');
}
