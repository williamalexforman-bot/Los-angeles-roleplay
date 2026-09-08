import type { Client, Message } from 'discord.js';
import { handleApplicationDmMessage } from '../commands/applications';
import { handleAppealDmMessage, setBanAppealClient } from '../commands/banAppeal';
import { setInfractionAppealClient } from '../commands/infractionAppeal';
import { setDiscordClientForDm } from '../commands/punishment';
import { registerRoleAdCreatorRuntime } from '../commands/roleAdCreator';
import { configureApplicationSessionDatabaseAdapter } from '../database/applicationSessionAdapter';
import { configureInfractionDatabaseAdapter } from '../database/infractionAdapter';
import { logger } from '../utils/logger';
import { installLegacyTicketSubmitPatch } from './legacyTicketSubmitPatch';
import { handleMessageModeration } from './messageModeration';

export type ProductionMessageRoute = 'application' | 'ban-appeal' | 'moderation' | 'ignored';

/** Installs dependencies required by commands that send DMs or persist state. */
export function configureProductionRuntime(client: Client): void {
    setDiscordClientForDm(client);
    setBanAppealClient(client);
    setInfractionAppealClient(client);
    configureInfractionDatabaseAdapter();
    configureApplicationSessionDatabaseAdapter();
    registerRoleAdCreatorRuntime(client);
    installLegacyTicketSubmitPatch(client);
    logger.info('[Runtime] Command clients, durable application/infraction adapters, role marketplace ad creation, and legacy ticket modal submission configured. Ticket interactions are handled exclusively by the stable router; infraction recovery logging is disabled.');
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
