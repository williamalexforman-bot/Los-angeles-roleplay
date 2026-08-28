import type { Client, Message } from 'discord.js';
import { handleApplicationDmMessage } from '../commands/applications';
import { handleAppealDmMessage, setBanAppealClient } from '../commands/banAppeal';
import { setInfractionAppealClient } from '../commands/infractionAppeal';
import { setDiscordClientForDm } from '../commands/punishment';
import { configureApplicationSessionDatabaseAdapter } from '../database/applicationSessionAdapter';
import { configureInfractionDatabaseAdapter } from '../database/infractionAdapter';
import { logger } from '../utils/logger';
import { registerInfractionAudit } from './infractionAudit';
import { handleMessageModeration } from './messageModeration';
import { registerTicketSelectAckGuard } from './ticketSelectAckGuard';

export type ProductionMessageRoute = 'application' | 'ban-appeal' | 'moderation' | 'ignored';

/** Installs dependencies required by commands that send DMs or persist state. */
export function configureProductionRuntime(client: Client): void {
    setDiscordClientForDm(client);
    setBanAppealClient(client);
    setInfractionAppealClient(client);
    configureInfractionDatabaseAdapter();
    configureApplicationSessionDatabaseAdapter();
    registerInfractionAudit(client);
    registerTicketSelectAckGuard(client);
    logger.info('[Runtime] Command clients, durable application/infraction adapters, infraction verification, and early ticket-select acknowledgement configured.');
}

/** Routes DM conversations before guild-message moderation. */
export async function routeProductionMessage(
    message: Message,
    messageModerationEnabled: boolean,
): Promise<ProductionMessageRoute> {
    if (await handleApplicationDmMessage(message)) return 'application';
    if (await handleAppealDmMessage(message)) return 'ban-appeal';
    if (!messageModerationEnabled) return 'ignored';
    await handleMessageModeration(message);
    return 'moderation';
}
