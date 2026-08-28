import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Ticket category selects are handled directly by the stable interaction router.
 * No separate InteractionCreate acknowledgement listener is registered here.
 *
 * The blacklist pre-check was removed, so handleTicketSelect can reply immediately
 * without an extra defer/ack layer. Keeping this module as a no-op preserves the
 * production runtime import while preventing duplicate acknowledgements, 40060,
 * Unknown Interaction, and InteractionNotReplied races.
 */
export function registerTicketSelectAckGuard(_client: Client): void {
    logger.info('[TicketAckGuard] DISABLED: StableRouter exclusively handles ticket:create-select replies.');
}
