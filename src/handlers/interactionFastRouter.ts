import type { Interaction } from 'discord.js';
import { handleTicketButton, handleTicketModal, handleTicketSelect } from '../commands/tickets';
import { handleApplicationButton, handleApplicationModal, handleApplicationSelect } from '../commands/applications';
import { handleSessionButton } from '../commands/session';
import { handleEnhancedSessionButton } from '../commands/sessionEnhancements';
import { logger } from '../utils/logger';

type InteractionRouterModule = {
    interactionCreate(interaction: Interaction): Promise<void>;
};

export function installInteractionFastRouter(routerModule: InteractionRouterModule): void {
    const original = routerModule.interactionCreate.bind(routerModule);

    routerModule.interactionCreate = async (interaction: Interaction): Promise<void> => {
        try {
            if (interaction.isButton()) {
                const id = interaction.customId;
                if (id.startsWith('ticket:') || id.startsWith('ticket-feedback:')) {
                    if (await handleTicketButton(interaction)) return;
                }
                if (id.startsWith('applications:')) {
                    if (await handleApplicationButton(interaction)) return;
                }
                if (id.startsWith('session:vote:cast')) {
                    // The original session handler can recover the visible vote
                    // count directly from the Discord V2 message after a restart,
                    // so voting remains available even when MongoDB is offline.
                    if (await handleSessionButton(interaction)) return;
                }
                if (id.startsWith('session:')) {
                    if (await handleEnhancedSessionButton(interaction)) return;
                    if (await handleSessionButton(interaction)) return;
                }
            }

            if (interaction.isModalSubmit()) {
                const id = interaction.customId;
                if (id.startsWith('ticket:') || id.startsWith('ticket-feedback:')) {
                    if (await handleTicketModal(interaction)) return;
                }
                if (id.startsWith('applications:')) {
                    if (await handleApplicationModal(interaction)) return;
                }
            }

            if (interaction.isStringSelectMenu()) {
                const id = interaction.customId;
                if (id.startsWith('ticket:')) {
                    if (await handleTicketSelect(interaction)) return;
                }
                if (id.startsWith('applications:')) {
                    if (await handleApplicationSelect(interaction)) return;
                }
            }

            await original(interaction);
        } catch (error) {
            logger.error(`[Fast Router] Interaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (!interaction.isRepliable()) return;
            try {
                if (interaction.deferred) {
                    await interaction.editReply('That action hit an unexpected error. Please try again.');
                } else if (interaction.replied) {
                    await interaction.followUp({ content: 'That action hit an unexpected error. Please try again.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'That action hit an unexpected error. Please try again.', ephemeral: true });
                }
            } catch {
                // Discord may have already expired the interaction.
            }
        }
    };

    logger.info('[Fast Router] Ticket, application, and session interactions use direct dispatch.');
}
