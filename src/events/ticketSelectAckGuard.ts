import {
    Events,
    MessageFlags,
    type Client,
    type InteractionReplyOptions,
} from 'discord.js';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();

function discordErrorCode(error: unknown): number | string | null {
    const candidate = error as { code?: number | string; rawError?: { code?: number | string } } | null;
    return candidate?.code ?? candidate?.rawError?.code ?? null;
}

function editPayload(payload: InteractionReplyOptions): Record<string, unknown> {
    const { flags, ...rest } = payload as InteractionReplyOptions & { flags?: number };
    const numericFlags = Number(flags || 0);
    const editableFlags = numericFlags & ~MessageFlags.Ephemeral;
    return editableFlags ? { ...rest, flags: editableFlags } : rest;
}

/**
 * A ticket category select must be acknowledged before slower member/blacklist
 * work begins. EventEmitter does not await async listeners, so the handler's
 * reply method is replaced synchronously before the defer request starts.
 *
 * If Discord reports 40060, Discord has already accepted an acknowledgement
 * even though discord.js did not update its local flags. In that case we sync
 * the local deferred flag so editReply/followUp are legal again.
 */
export function registerTicketSelectAckGuard(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.prependListener(Events.InteractionCreate, interaction => {
        if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket:create-select') return;

        const mutable = interaction as typeof interaction & {
            deferred: boolean;
            replied: boolean;
            reply: (options: InteractionReplyOptions) => Promise<unknown>;
        };
        const originalReply = mutable.reply.bind(mutable);
        const originalEditReply = mutable.editReply.bind(mutable);

        const ackPromise: Promise<'deferred' | 'server-acknowledged' | 'failed'> =
            mutable.deferred || mutable.replied
                ? Promise.resolve('server-acknowledged')
                : mutable.deferReply({ flags: MessageFlags.Ephemeral })
                    .then(() => 'deferred' as const)
                    .catch(error => {
                        const code = discordErrorCode(error);
                        if (code === 40060 || code === '40060') {
                            // Discord accepted an acknowledgement somewhere in this
                            // runtime path but discord.js did not reflect it locally.
                            mutable.deferred = true;
                            logger.warn('[TicketAckGuard] Recovered Discord 40060 by synchronizing the local deferred state.');
                            return 'server-acknowledged' as const;
                        }
                        logger.warn(`[TicketAckGuard] Could not pre-acknowledge ticket select: ${error instanceof Error ? error.message : String(error)}`);
                        return 'failed' as const;
                    });

        mutable.reply = async (options: InteractionReplyOptions): Promise<unknown> => {
            const ackState = await ackPromise;

            if (ackState === 'deferred' || ackState === 'server-acknowledged' || mutable.deferred) {
                // Keep discord.js in sync before editReply checks its local state.
                mutable.deferred = true;
                return originalEditReply(editPayload(options) as never);
            }

            return originalReply(options);
        };
    });

    logger.info('[TicketAckGuard] ENABLED: ticket:create-select uses synchronized deferred acknowledgement handling.');
}
