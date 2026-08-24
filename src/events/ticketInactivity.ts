import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

// Temporarily disabled while the bot recovers from Discord/Cloudflare REST
// rate limits. This feature is nonessential to login/commands and previously
// performed repeated channel/message REST scans. Re-enable after the gateway
// and slash-command path are confirmed stable.
export function startTicketInactivityScheduler(_client: Client): void {
    logger.warn('[TicketInactivity] Disabled during Discord recovery; no REST scans will run.');
}
