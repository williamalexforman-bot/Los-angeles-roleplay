import type { Client, Message, TextBasedChannel } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { logger } from '../utils/logger';

const DASHBOARD_CHANNEL_ID = '1526049604712529971';
const ASSISTANCE_CHANNEL_ID = '1526034504953892925';

async function recentBotPanel(channel: TextBasedChannel, botId: string, predicate: (message: Message) => boolean): Promise<Message | null> {
    if (!('messages' in channel)) return null;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    return recent?.find(message => message.author.id === botId && message.components.length > 0 && predicate(message)) || null;
}

export async function refreshPersistentPanels(client: Client): Promise<void> {
    if (!client.user) return;

    try {
        const dashboardModule = require('../commands/dashboard.ts') as {
            buildDashboardRefreshPayload?: () => unknown;
        };
        const channel = await client.channels.fetch(DASHBOARD_CHANNEL_ID).catch(() => null);
        if (channel?.isTextBased() && 'messages' in channel && typeof dashboardModule.buildDashboardRefreshPayload === 'function') {
            const message = await recentBotPanel(channel, client.user.id, candidate => {
                const raw = JSON.stringify(candidate.components.map(component => component.toJSON()));
                return raw.includes('dashboard:menu') || raw.includes('dashboard:role:session');
            });
            if (message) {
                await message.edit(dashboardModule.buildDashboardRefreshPayload() as never);
                logger.info('[PersistentPanels] Dashboard panel refreshed in place.');
            }
        }
    } catch (error) {
        logger.warn(`[PersistentPanels] Dashboard refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const ticketModule = require('../commands/tickets.ts') as {
            buildTicketPanelRefreshPayload?: () => unknown;
        };
        const channel = await client.channels.fetch(ASSISTANCE_CHANNEL_ID).catch(() => null);
        if (channel?.isTextBased() && 'messages' in channel && typeof ticketModule.buildTicketPanelRefreshPayload === 'function') {
            const message = await recentBotPanel(channel, client.user.id, candidate => {
                const raw = JSON.stringify(candidate.components.map(component => component.toJSON()));
                return raw.includes('ticket:create-select');
            });
            if (message) {
                await message.edit(ticketModule.buildTicketPanelRefreshPayload() as never);
                logger.info('[PersistentPanels] Assistance panel refreshed in place.');
            }
        }
    } catch (error) {
        logger.warn(`[PersistentPanels] Assistance refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
