import { AttachmentBuilder, type Client, type Message } from 'discord.js';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type PersistentPanel = {
    channelId: string;
    marker: string;
    bannerName: string;
};

const UNDERBANNER_NAME = 'underbanner.png';
const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');

const PANELS: readonly PersistentPanel[] = [
    { channelId: '1526049604712529971', marker: 'Los Angeles Dashboard', bannerName: 'dashboard-banner.png' },
    { channelId: '1526034504953892925', marker: 'Los Angeles Roleplay Support', bannerName: 'assistance-banner.png' },
    { channelId: '1526035041593856182', marker: 'Applications', bannerName: 'applications-banner.png' },
    { channelId: '1526035127606706196', marker: 'Marketplace', bannerName: 'paid-ad-banner.png' },
];

type ComponentNode = { content?: unknown; components?: readonly ComponentNode[] };
function componentText(nodes: readonly ComponentNode[] | undefined): string {
    if (!nodes) return '';
    return nodes.map(node => `${typeof node.content === 'string' ? node.content : ''}\n${componentText(node.components)}`).join('\n');
}

function messageText(message: Message): string {
    const serialized = message.components.map(component => component.toJSON() as ComponentNode);
    return componentText(serialized);
}

async function refreshPanel(client: Client, panel: PersistentPanel): Promise<void> {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!recent?.size) return;
    const message = recent.find(candidate =>
        candidate.author.id === client.user?.id
        && candidate.components.length > 0
        && messageText(candidate).includes(panel.marker),
    );
    if (!message) return;

    const bannerPath = resolve(ASSETS_ROOT, panel.bannerName);
    const underbannerPath = resolve(ASSETS_ROOT, UNDERBANNER_NAME);
    await message.edit({
        components: message.components.map(component => component.toJSON()),
        attachments: [],
        files: [
            new AttachmentBuilder(bannerPath, { name: panel.bannerName }),
            new AttachmentBuilder(underbannerPath, { name: UNDERBANNER_NAME }),
        ],
        allowedMentions: { parse: [] },
    }).catch(error => {
        logger.warn(`[Banners] Could not refresh persistent panel in ${panel.channelId}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

export async function refreshPersistentPanelBanners(client: Client): Promise<void> {
    for (const panel of PANELS) await refreshPanel(client, panel);
    logger.info('[Banners] Persistent panel banner refresh completed.');
}
