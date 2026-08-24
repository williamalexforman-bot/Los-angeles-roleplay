import type { Client, Message, TextBasedChannel } from 'discord.js';
import { logger } from '../utils/logger';

type PersistentPanelSpec = {
    channelId: string;
    label: string;
    marker: string;
    modulePath: string;
    builderName: string;
    needsGuild?: boolean;
};

const PANELS: readonly PersistentPanelSpec[] = [
    {
        channelId: '1526049604712529971',
        label: 'Dashboard',
        marker: 'dashboard:menu',
        modulePath: '../commands/dashboard.ts',
        builderName: 'buildDashboardRefreshPayload',
    },
    {
        channelId: '1526034504953892925',
        label: 'Assistance',
        marker: 'ticket:create-select',
        modulePath: '../commands/tickets.ts',
        builderName: 'buildTicketPanelRefreshPayload',
    },
    {
        channelId: '1526035041593856182',
        label: 'Applications',
        marker: 'applications:type',
        modulePath: '../commands/applications.ts',
        builderName: 'buildApplicationsPanelRefreshPayload',
        needsGuild: true,
    },
    {
        channelId: '1526035127606706196',
        label: 'Marketplace',
        marker: 'marketplace:claim',
        modulePath: '../commands/marketplace.ts',
        builderName: 'buildMarketplacePanelRefreshPayload',
    },
];

async function recentBotPanel(channel: TextBasedChannel, botId: string, marker: string): Promise<Message | null> {
    if (!('messages' in channel)) return null;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    return recent?.find(message => {
        if (message.author.id !== botId || message.components.length === 0) return false;
        const raw = JSON.stringify(message.components.map(component => component.toJSON()));
        return raw.includes(marker);
    }) || null;
}

async function refreshPanel(client: Client, spec: PersistentPanelSpec): Promise<void> {
    const loaded = require(spec.modulePath) as Record<string, unknown>;
    const builder = loaded[spec.builderName];
    if (typeof builder !== 'function') throw new Error(`${spec.builderName} is unavailable.`);

    const channel = await client.channels.fetch(spec.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) {
        throw new Error(`Channel ${spec.channelId} is unavailable.`);
    }
    const message = await recentBotPanel(channel, client.user!.id, spec.marker);
    if (!message) throw new Error(`No existing bot panel was found in ${spec.channelId}.`);

    const guild = 'guild' in channel ? channel.guild : null;
    const payload = spec.needsGuild ? builder(guild) : builder();
    if (!payload || typeof payload !== 'object') throw new Error(`${spec.builderName} returned no payload.`);

    // Clear old attachment IDs so attachment:// URLs cannot keep resolving to
    // the previous low-resolution or obsolete banner files.
    await message.edit({ ...(payload as Record<string, unknown>), attachments: [] } as never);
    logger.info(`[PersistentPanels] ${spec.label} panel rebuilt with the current banner files.`);
}

export async function refreshPersistentPanels(client: Client): Promise<void> {
    if (!client.user) return;
    for (const spec of PANELS) {
        try {
            await refreshPanel(client, spec);
        } catch (error) {
            logger.warn(`[PersistentPanels] ${spec.label} refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
