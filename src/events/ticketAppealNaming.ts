import { Client } from 'discord.js';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();

/**
 * Ticket naming is owned exclusively by ticketPriority.ts.
 *
 * This module intentionally does not rename channels anymore. The previous
 * implementation waited 1.2 seconds and then overwrote specific names such as
 * `ban-appeal` or `warning-appeal` with the generic `🟢-appeal`, which caused
 * two independent naming systems to fight each other.
 */
export function registerTicketAppealNaming(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    logger.info('[Ticket Appeal Naming] Disabled: ticketPriority.ts is the single authoritative ticket namer.');
}
