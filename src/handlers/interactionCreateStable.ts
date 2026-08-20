import {
    ChatInputCommandInteraction,
    Interaction,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger';

async function safeReply(interaction: Interaction, message: string): Promise<void> {
    if (!interaction.isRepliable()) return;
    try {
        if (interaction.deferred) await interaction.editReply({ content: message });
        else if (interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    } catch {
        // The interaction may have expired.
    }
}

async function runCriticalActivity(interaction: Interaction): Promise<boolean> {
    try {
        const activity = require('../commands/activityCheck.ts') as {
            activityCheckCommands?: Array<{ data: { name: string }; execute: (i: ChatInputCommandInteraction) => Promise<unknown> }>;
            handleActivityCheckButton?: (i: any) => Promise<boolean>;
        };

        if (interaction.isButton() && interaction.customId.startsWith('activity-check:')) {
            if (typeof activity.handleActivityCheckButton !== 'function') throw new Error('Activity button handler is unavailable.');
            return await activity.handleActivityCheckButton(interaction);
        }

        if (interaction.isChatInputCommand()) {
            const command = activity.activityCheckCommands?.find(entry => entry.data.name === interaction.commandName);
            if (command) {
                await command.execute(interaction);
                return true;
            }
        }
    } catch (error) {
        if ((interaction.isButton() && interaction.customId.startsWith('activity-check:'))
            || (interaction.isChatInputCommand() && ['activity-check', 'view-activity-check', 'end-activity-check', 'void-activity-check', 'activitycheck', 'stopactivitycheck'].includes(interaction.commandName))) {
            logger.error(`[StableRouter] Activity Check failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await safeReply(interaction, 'Activity Check hit an internal error. The rest of the bot is still online. Please try again.');
            return true;
        }
    }
    return false;
}

async function runCriticalTickets(interaction: Interaction): Promise<boolean> {
    try {
        const tickets = require('../commands/tickets.ts') as {
            isTicketPanelCommandName?: (name: string) => boolean;
            postTicketPanel?: (i: ChatInputCommandInteraction) => Promise<void>;
            handleTicketButton?: (i: any) => Promise<boolean>;
            handleTicketModal?: (i: any) => Promise<boolean>;
            handleTicketSelect?: (i: any) => Promise<boolean>;
        };

        if (interaction.isChatInputCommand()
            && tickets.isTicketPanelCommandName?.(interaction.commandName)) {
            if (typeof tickets.postTicketPanel !== 'function') throw new Error('Ticket panel command handler is unavailable.');
            await tickets.postTicketPanel(interaction);
            return true;
        }

        if (interaction.isButton()) {
            try {
                const repair = require('./ticketClaimRepair.ts') as { handleTicketClaimRepair?: (i: any) => Promise<boolean> };
                if (typeof repair.handleTicketClaimRepair === 'function' && await repair.handleTicketClaimRepair(interaction)) return true;
            } catch (error) {
                logger.warn(`[StableRouter] Ticket claim repair unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (typeof tickets.handleTicketButton === 'function' && await tickets.handleTicketButton(interaction)) return true;
        }

        if (interaction.isModalSubmit()
            && typeof tickets.handleTicketModal === 'function'
            && await tickets.handleTicketModal(interaction)) return true;

        if (interaction.isStringSelectMenu()
            && typeof tickets.handleTicketSelect === 'function'
            && await tickets.handleTicketSelect(interaction)) return true;
    } catch (error) {
        const looksTicket = interaction.isChatInputCommand()
            ? /ticket|panel|open|claim|close|rename|reopen|add|remove/i.test(interaction.commandName)
            : interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()
                ? interaction.customId.startsWith('ticket') || interaction.customId.includes('ticket')
                : false;
        if (looksTicket) {
            logger.error(`[StableRouter] Tickets failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await safeReply(interaction, 'The ticket system hit an internal error, but other bot systems are still online. Please try again.');
            return true;
        }
    }
    return false;
}

async function runCriticalApplications(interaction: Interaction): Promise<boolean> {
    try {
        const applications = require('../commands/applications.ts') as {
            applicationsPanelCommand?: { data: { name: string }; execute: (i: ChatInputCommandInteraction) => Promise<void> };
            handleApplicationButton?: (i: any) => Promise<boolean>;
            handleApplicationModal?: (i: any) => Promise<boolean>;
            handleApplicationSelect?: (i: any) => Promise<boolean>;
        };

        if (interaction.isChatInputCommand()
            && applications.applicationsPanelCommand?.data.name === interaction.commandName) {
            await applications.applicationsPanelCommand.execute(interaction);
            return true;
        }
        if (interaction.isButton()
            && typeof applications.handleApplicationButton === 'function'
            && await applications.handleApplicationButton(interaction)) return true;
        if (interaction.isModalSubmit()
            && typeof applications.handleApplicationModal === 'function'
            && await applications.handleApplicationModal(interaction)) return true;
        if (interaction.isStringSelectMenu()
            && typeof applications.handleApplicationSelect === 'function'
            && await applications.handleApplicationSelect(interaction)) return true;
    } catch (error) {
        const looksApplication = interaction.isChatInputCommand()
            ? interaction.commandName === 'applications-panel'
            : interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()
                ? interaction.customId.startsWith('applications:')
                : false;
        if (looksApplication) {
            logger.error(`[StableRouter] Applications failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await safeReply(interaction, 'The application system hit an internal error, but other bot systems are still online. Please try again.');
            return true;
        }
    }
    return false;
}

async function runOptionalInteraction(interaction: Interaction): Promise<boolean> {
    const attempts: Array<() => Promise<boolean>> = [];

    if (interaction.isButton()) {
        attempts.push(
            async () => Boolean(await require('../commands/messageQuota.ts').handleMessageQuotaButton?.(interaction)),
            async () => Boolean(await require('../commands/suggestions.ts').handleSuggestionButton?.(interaction)),
            async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdButton?.(interaction)),
            async () => Boolean(await require('../commands/community.ts').handleCommunityButton?.(interaction)),
            async () => Boolean(await require('../commands/staffManagement.ts').handleStaffManagementButton?.(interaction)),
            async () => Boolean(await require('../commands/loa.ts').handleLoaButton?.(interaction)),
            async () => Boolean(await require('../commands/banAppeal.ts').handleBanAppealButton?.(interaction)),
            async () => Boolean(await require('../commands/infractionAppeal.ts').handleInfractionAppealButton?.(interaction)),
            async () => Boolean(await require('../commands/sessionEnhancements.ts').handleEnhancedSessionButton?.(interaction)),
            async () => Boolean(await require('../commands/session.ts').handleSessionButton?.(interaction)),
        );
    } else if (interaction.isModalSubmit()) {
        attempts.push(
            async () => Boolean(await require('../commands/messageQuota.ts').handleMessageQuotaModal?.(interaction)),
            async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdModal?.(interaction)),
            async () => Boolean(await require('../commands/requestTraining.ts').handleTrainingModal?.(interaction)),
            async () => Boolean(await require('../commands/community.ts').handleCommunityModal?.(interaction)),
            async () => Boolean(await require('../commands/staffManagement.ts').handleStaffManagementModal?.(interaction)),
            async () => Boolean(await require('../commands/loa.ts').handleLoaModal?.(interaction)),
            async () => Boolean(await require('../commands/banAppeal.ts').handleBanAppealModal?.(interaction)),
            async () => Boolean(await require('../commands/infractionAppeal.ts').handleInfractionAppealModal?.(interaction)),
        );
    } else if (interaction.isStringSelectMenu()) {
        attempts.push(
            async () => Boolean(await require('../commands/advancedPaidAds.ts').handleAdvancedPaidAdSelect?.(interaction)),
            async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdSelect?.(interaction)),
        );
    }

    for (const attempt of attempts) {
        try {
            if (await attempt()) return true;
        } catch (error) {
            logger.warn(`[StableRouter] Optional interaction module failed without taking down the router: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return false;
}

async function runNormalSlashCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        const registry = require('../commands/registry.ts') as {
            commandHandlers?: Map<string, (i: ChatInputCommandInteraction) => Promise<unknown>>;
        };
        const handler = registry.commandHandlers?.get(interaction.commandName);
        if (!handler) return false;
        await handler(interaction);
        return true;
    } catch (error) {
        logger.error(`[StableRouter] Command ${interaction.commandName} failed without taking down critical systems: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'That command hit an internal error. Activity Check, Tickets, and Applications remain isolated and available.');
        return true;
    }
}

export async function interactionCreateStable(interaction: Interaction): Promise<void> {
    try {
        if (await runCriticalActivity(interaction)) return;
        if (await runCriticalTickets(interaction)) return;
        if (await runCriticalApplications(interaction)) return;
        if (await runOptionalInteraction(interaction)) return;

        if (interaction.isChatInputCommand()) {
            if (await runNormalSlashCommand(interaction)) return;
            await safeReply(interaction, 'That command is not currently available.');
        }
    } catch (error) {
        logger.error(`[StableRouter] Top-level interaction error contained: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'The bot hit an internal interaction error. Please try again.');
    }
}
