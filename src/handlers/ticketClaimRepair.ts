import type { ButtonInteraction } from 'discord.js';

/**
 * Retired repair hook. Claim handling now lives exclusively in
 * src/commands/tickets.ts so one interaction can only have one owner.
 */
export async function handleTicketClaimRepair(_interaction: ButtonInteraction): Promise<boolean> {
    return false;
}
