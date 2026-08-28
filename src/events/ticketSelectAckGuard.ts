import { Events, MessageFlags, type Client } from 'discord.js';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();
const TARGET_CUSTOM_ID = 'ticket:create-select';

/**
 * Discord component interactions must be acknowledged within a few seconds.
 * This guard is registered before the main Stable Router. It reserves the
 * ticket category select immediately, then makes the legacy ticket handler's
 * first reply transparently become editReply so the interaction is only
 * acknowledged once.
 */
export function registerTicketSelectAckGuard(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.InteractionCreate, interaction => {
        if (!interaction.isStringSelectMenu() || interaction.customId !== TARGET_CUSTOM_ID) return;
        if (interaction.deferred || interaction.replied) return;

        const select = interaction;
        const originalReply = select.reply.bind(select);
        const mutableSelect = select as unknown as {
            reply: (options: unknown) => Promise<unknown>;
        };

        // Start the acknowledgement immediately. Do not wait for ticket module
        // loading, permission checks, artwork resolution, or any other work.
        const acknowledgement = select.deferReply({ flags: MessageFlags.Ephemeral });

        mutableSelect.reply = async (options: unknown): Promise<unknown> => {
            await acknowledgement;

            if (select.deferred) {
                const payload: Record<string, unknown> = options && typeof options === 'object'
                    ? { ...(options as Record<string, unknown>) }
                    : { content: String(options ?? '') };

                // editReply cannot change ephemeral/component flags after the
                // initial defer; the defer already established Ephemeral.
                delete payload.flags;
                return select.editReply(payload as never);
            }

            return originalReply(options as never);
        };

        void acknowledgement.then(() => {
            logger.info(`[TicketAckGuard] Reserved ${TARGET_CUSTOM_ID} interaction ${select.id} before ticket routing.`);
        }).catch(error => {
            logger.warn(`[TicketAckGuard] Could not reserve ${TARGET_CUSTOM_ID} interaction ${select.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
    });

    logger.info('[TicketAckGuard] Early ticket category acknowledgement enabled.');
}
