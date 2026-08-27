import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Ticket presentation rewriting is intentionally disabled.
 *
 * The core ticket command in src/commands/tickets.ts owns the opening panel
 * and its Claim / Close / Escalate buttons. Keeping this compatibility
 * registration as a no-op prevents older startup wiring from rewriting the
 * original ticket format after the ticket is created.
 */
export function registerTicketArtworkConsistency(_client: Client): void {
    logger.info('[TicketPresentation] Original ticket opening format enabled; post-create layout rewriting is disabled.');
}
