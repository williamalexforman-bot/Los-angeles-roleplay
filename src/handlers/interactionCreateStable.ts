import {
    ChatInputCommandInteraction,
    Interaction,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger';

const ACTIVITY_COMMANDS = new Set([
    'activity-check',
    'view-activity-check',
    'end-activity-check',
    'void-activity-check',
]);

const TICKET_COMMANDS = new Set([
    'ticket',
    'ticket-panel',
    'ticketpanel',
    'close',
    'closerequest',
    'unclaim',
]);

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

function isActivityInteraction(interaction: Interaction): boolean {
    if (interaction.isChatInputCommand()) return ACTIVITY_COMMANDS.has(interaction.commandName);
    return interaction.isButton() && interaction.customId.startsWith('activity-check:');
}

function isTicketInteraction(interaction: Interaction): boolean {
    if (interaction.isChatInputCommand()) return TICKET_COMMANDS.has(interaction.commandName);
    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
        return interaction.customId.startsWith('ticket:') || interaction.customId.startsWith('ticket-');
    }
    return false;
}

function isApplicationInteraction(interaction: Interaction): boolean {
    if (interaction.isChatInputCommand()) return interaction.commandName === 'applications-panel';
    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
        return interaction.customId.startsWith('applications:');
    }
    return false;
}

async function runCriticalActivity(interaction: Interaction): Promise<boolean> {
    if (!isActivityInteraction(interaction)) return false;

    try {
        const activity = require('../commands/activityCheck.ts') as {
            activityCheckCommands?: Array<{ data: { name: string }; execute: (i: ChatInputCommandInteraction) => Promise<unknown> }>;
            handleActivityCheckButton?: (i: any) => Promise<boolean>;
        };

        if (interaction.isButton()) {
            if (typeof activity.handleActivityCheckButton !== 'function') throw new Error('Activity button handler is unavailable.');
            return await activity.handleActivityCheckButton(interaction);
        }

        if (interaction.isChatInputCommand()) {
            const command = activity.activityCheckCommands?.find(entry => entry.data.name === interaction.commandName);
            if (!command) throw new Error(`Activity command ${interaction.commandName} is unavailable.`);
            await command.execute(interaction);
            return true;
        }
    } catch (error) {
        logger.error(`[StableRouter] Activity Check failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'Activity Check hit an internal error. The rest of the bot is still online. Please try again.');
        return true;
    }

    return false;
}

async function runCriticalTickets(interaction: Interaction): Promise<boolean> {
    if (!isTicketInteraction(interaction)) return false;

    try {
        const tickets = require('../commands/tickets.ts') as {
            ticketCommands?: Array<{ data: { name: string }; execute: (i: ChatInputCommandInteraction) => Promise<unknown> }>;
            handleTicketButton?: (i: any) => Promise<boolean>;
            handleTicketModal?: (i: any) => Promise<boolean>;
            handleTicketSelect?: (i: any) => Promise<boolean>;
        };

        if (interaction.isChatInputCommand()) {
            const command = tickets.ticketCommands?.find(entry => entry.data.name === interaction.commandName);
            if (!command) throw new Error(`Ticket command ${interaction.commandName} is unavailable.`);
            await command.execute(interaction);
            return true;
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'ticket:claim') {
                try {
                    const repair = require('./ticketClaimRepair.ts') as { handleTicketClaimRepair?: (i: any) => Promise<boolean> };
                    if (typeof repair.handleTicketClaimRepair === 'function' && await repair.handleTicketClaimRepair(interaction)) return true;
                } catch (error) {
                    logger.warn(`[StableRouter] Ticket claim repair unavailable: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (typeof tickets.handleTicketButton === 'function' && await tickets.handleTicketButton(interaction)) return true;
        }

        if (interaction.isModalSubmit()
            && typeof tickets.handleTicketModal === 'function'
            && await tickets.handleTicketModal(interaction)) return true;

        if (interaction.isStringSelectMenu()
            && typeof tickets.handleTicketSelect === 'function'
            && await tickets.handleTicketSelect(interaction)) return true;

        throw new Error(`No ticket handler accepted ${interaction.isChatInputCommand() ? interaction.commandName : interaction.customId}.`);
    } catch (error) {
        logger.error(`[StableRouter] Tickets failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'The ticket system hit an internal error, but other bot systems are still online. Please try again.');
        return true;
    }
}

async function runCriticalApplications(interaction: Interaction): Promise<boolean> {
    if (!isApplicationInteraction(interaction)) return false;

    try {
        const applications = require('../commands/applications.ts') as {
            applicationsPanelCommand?: { data: { name: string }; execute: (i: ChatInputCommandInteraction) => Promise<void> };
            handleApplicationButton?: (i: any) => Promise<boolean>;
            handleApplicationModal?: (i: any) => Promise<boolean>;
            handleApplicationSelect?: (i: any) => Promise<boolean>;
        };

        if (interaction.isChatInputCommand()) {
            if (!applications.applicationsPanelCommand) throw new Error('Applications panel command is unavailable.');
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

        throw new Error(`No application handler accepted ${interaction.customId}.`);
    } catch (error) {
        logger.error(`[StableRouter] Applications failed independently: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'The application system hit an internal error, but other bot systems are still online. Please try again.');
        return true;
    }
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
        logger.error(`[StableRouter] Command ${interaction.commandName} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'That command hit an internal error. Please try again.');
        return true;
    }
}

async function runOptionalComponent(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu())) return false;
    const id = interaction.customId;

    const attempts: Array<() => Promise<boolean>> = [];

    if (id.startsWith('loa:')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/loa.ts').handleLoaButton?.(interaction)));
        if (interaction.isModalSubmit()) attempts.push(async () => Boolean(await require('../commands/loa.ts').handleLoaModal?.(interaction)));
    } else if (id.startsWith('applications:') || id.startsWith('ticket:') || id.startsWith('activity-check:')) {
        return false;
    } else if (id.startsWith('dashboard:')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/dashboard.ts').handleDashboardButton?.(interaction)));
        if (interaction.isStringSelectMenu()) attempts.push(async () => Boolean(await require('../commands/dashboard.ts').handleDashboardSelect?.(interaction)));
    } else if (id.startsWith('suggestion')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/suggestions.ts').handleSuggestionButton?.(interaction)));
    } else if (id.includes('paid') || id.includes('advert')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdButton?.(interaction)));
        if (interaction.isModalSubmit()) attempts.push(async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdModal?.(interaction)));
        if (interaction.isStringSelectMenu()) {
            attempts.push(
                async () => Boolean(await require('../commands/advancedPaidAds.ts').handleAdvancedPaidAdSelect?.(interaction)),
                async () => Boolean(await require('../commands/paidAds.ts').handlePaidAdSelect?.(interaction)),
            );
        }
    } else if (id.startsWith('partnership:') || id.startsWith('community:')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/community.ts').handleCommunityButton?.(interaction)));
        if (interaction.isModalSubmit()) attempts.push(async () => Boolean(await require('../commands/community.ts').handleCommunityModal?.(interaction)));
    } else if (id.includes('infraction-appeal')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/infractionAppeal.ts').handleInfractionAppealButton?.(interaction)));
        if (interaction.isModalSubmit()) attempts.push(async () => Boolean(await require('../commands/infractionAppeal.ts').handleInfractionAppealModal?.(interaction)));
    } else if (id.includes('appeal')) {
        if (interaction.isButton()) attempts.push(async () => Boolean(await require('../commands/banAppeal.ts').handleBanAppealButton?.(interaction)));
        if (interaction.isModalSubmit()) attempts.push(async () => Boolean(await require('../commands/banAppeal.ts').handleBanAppealModal?.(interaction)));
    } else if (id.startsWith('session')) {
        if (interaction.isButton()) {
            attempts.push(
                async () => Boolean(await require('../commands/session.ts').handleSessionButton?.(interaction)),
                async () => Boolean(await require('../commands/sessionEnhancements.ts').handleEnhancedSessionButton?.(interaction)),
            );
        }
    } else {
        if (interaction.isButton()) {
            attempts.push(
                async () => Boolean(await require('../commands/community.ts').handleCommunityButton?.(interaction)),
                async () => Boolean(await require('../commands/staffManagement.ts').handleStaffManagementButton?.(interaction)),
            );
        }
        if (interaction.isModalSubmit()) {
            attempts.push(
                async () => Boolean(await require('../commands/requestTraining.ts').handleTrainingModal?.(interaction)),
                async () => Boolean(await require('../commands/community.ts').handleCommunityModal?.(interaction)),
                async () => Boolean(await require('../commands/staffManagement.ts').handleStaffManagementModal?.(interaction)),
            );
        }
    }

    for (const attempt of attempts) {
        try {
            if (await attempt()) return true;
        } catch (error) {
            logger.warn(`[StableRouter] Optional component failed without taking down the router: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return false;
}

export async function interactionCreateStable(interaction: Interaction): Promise<void> {
    try {
        if (isActivityInteraction(interaction)) {
            await runCriticalActivity(interaction);
            return;
        }
        if (isTicketInteraction(interaction)) {
            await runCriticalTickets(interaction);
            return;
        }
        if (isApplicationInteraction(interaction)) {
            await runCriticalApplications(interaction);
            return;
        }

        if (interaction.isChatInputCommand()) {
            if (await runNormalSlashCommand(interaction)) return;
            await safeReply(interaction, 'That command is not currently available.');
            return;
        }

        if (await runOptionalComponent(interaction)) return;
    } catch (error) {
        logger.error(`[StableRouter] Top-level interaction error contained: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await safeReply(interaction, 'The bot hit an internal interaction error. Please try again.');
    }
}
