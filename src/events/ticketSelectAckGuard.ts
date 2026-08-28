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
 * Ticket selects must be acknowledged immediately, before blacklist/member lookups
 * or any other potentially slow work. The normal ticket handler still calls
 * interaction.reply(), so this guard temporarily converts that reply into an
 * edit of the acknowledgement created here.
 *
 * This also recovers from Discord 40060 by sending the eventual ticket UI as a
 * follow-up instead of attempting a second interaction callback.
 */
export function registerTicketSelectAckGuard(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.prependListener(Events.InteractionCreate, interaction => {
        if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket:create-select') return;

        const mutable = interaction as typeof interaction & {
            reply: (options: InteractionReplyOptions) => Promise<unknown>;
        };
        const originalReply = mutable.reply.bind(mutable);
        const originalEditReply = mutable.editReply.bind(mutable);
        const originalFollowUp = mutable.followUp.bind(mutable);

        let ackPromise: Promise<'deferred' | 'already-acknowledged' | 'failed'>;
        if (mutable.deferred || mutable.replied) {
            ackPromise = Promise.resolve('already-acknowledged');
        } else {
            ackPromise = mutable.deferReply({ flags: MessageFlags.Ephemeral })
                .then(() => 'deferred' as const)
                .catch(error => {
                    const code = discordErrorCode(error);
                    if (code === 40060 || code === '40060') {
                        logger.warn('[TicketAckGuard] Discord reported the ticket select was already acknowledged; switching the ticket response to a follow-up.');
                        return 'already-acknowledged' as const;
                    }
                    logger.warn(`[TicketAckGuard] Could not pre-acknowledge ticket select: ${error instanceof Error ? error.message : String(error)}`);
                    return 'failed' as const;
                });
        }

        mutable.reply = async (options: InteractionReplyOptions): Promise<unknown> => {
            const ackState = await ackPromise;

            if (ackState === 'deferred' || mutable.deferred) {
                return originalEditReply(editPayload(options) as never);
            }

            if (ackState === 'already-acknowledged' || mutable.replied) {
                return originalFollowUp(options);
            }

            return originalReply(options);
        };
    });

    logger.info('[TicketAckGuard] ENABLED: ticket:create-select is acknowledged immediately and subsequent replies reuse that acknowledgement.');
}
