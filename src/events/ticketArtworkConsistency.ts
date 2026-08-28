import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Legacy ticket message rewriting is retired. The rebuilt ticket module owns
 * the final ticket layout directly, so no post-send mutation is required.
 */
export function registerTicketArtworkConsistency(_client: Client): void {
    logger.info('[TicketPresentation] Legacy ticket artwork rewrite disabled; rebuilt ticket layout is authoritative.');
}
