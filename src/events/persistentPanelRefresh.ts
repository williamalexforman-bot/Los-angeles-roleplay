import type { Client, Message, TextBasedChannel } from 'discord.js';
import { logger } from '../utils/logger';
import { findChannelByKey } from '../services/serverResourceResolver';

type PanelChannelKey = 'dashboard' | 'assistance' | 'rules' | 'applications' | 'marketplace';

type PersistentPanelSpec = {
    channelKey: PanelChannelKey;
    label: string;
    marker: string;
    modulePath: string;
    builderName: string;
    needsGuild?: boolean;
};

const PANELS: readonly PersistentPanelSpec[] = [
    { channelKey: 'dashboard', label: 'Dashboard', marker: 'dashboard:menu', modulePath: '../commands/dashboard.ts', builderName: 'buildDashboardRefreshPayload' },
    { channelKey: 'assistance', label: 'Assistance', marker: 'ticket:create-select', modulePath: '../commands/tickets.ts', builderName: 'buildTicketPanelRefreshPayload' },
    { channelKey: 'rules', label: 'Rules', marker: 'rules:menu', modulePath: '../commands/rules.ts', builderName: 'buildRulesPanelRefreshPayload' },
    { channelKey: 'applications', label: 'Applications', marker: 'applications:type', modulePath: '../commands/applications.ts', builderName: 'buildApplicationsPanelRefreshPayload', needsGuild: true },
    { channelKey: 'marketplace', label: 'Marketplace', marker: 'marketplace:claim', modulePath: '../commands/marketplace.ts', builderName: 'buildMarketplacePanelRefreshPayload' },
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
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('No guild is available for panel discovery.');

    const channel = await findChannelByKey(guild, spec.channelKey);
    if (!channel?.isTextBased() || !('messages' in channel)) {
        throw new Error(`Live ${spec.channelKey} channel could not be resolved.`);
    }

    const loaded = require(spec.modulePath) as Record<string, unknown>;
    const builder = loaded[spec.builderName];
    if (typeof builder !== 'function') throw new Error(`${spec.builderName} is unavailable.`);

    const message = await recentBotPanel(channel, client.user!.id, spec.marker);
    if (!message) throw new Error(`No existing bot panel was found in #${channel.name} (${channel.id}).`);

    const payload = spec.needsGuild ? builder(guild) : builder();
    if (!payload || typeof payload !== 'object') throw new Error(`${spec.builderName} returned no payload.`);

    await message.edit({ ...(payload as Record<string, unknown>), attachments: [] } as never);
    logger.info(`[PersistentPanels] ${spec.label} refreshed in #${channel.name} (${channel.id}) using live channel discovery.`);
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
