import type { Interaction } from 'discord.js';

/**
 * Legacy compatibility hook retained for the stable router.
 * The rebuilt ticket system is handled exclusively by src/commands/tickets.ts.
 */
export async function handleDirectTicketInteraction(_interaction: Interaction): Promise<boolean> {
    return false;
}
