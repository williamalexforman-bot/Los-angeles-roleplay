import { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, type Client, type Message } from 'discord.js';
import { resolve } from 'path';
import { logger } from '../utils/logger';

const PARTNERSHIP_BANNER_NAME = 'partnership-banner.jpg';
const PARTNERSHIP_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PARTNERSHIP_BANNER_NAME);
const PAID_AD_BANNER_NAME = 'paid-ad-banner.jpg';
const PAID_AD_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PAID_AD_BANNER_NAME);

let installed = false;

type ComponentNode = {
    type?: number;
    content?: string;
    components?: ComponentNode[];
    items?: unknown[];
};

function flattenText(message: Message): string {
    const parts: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.content === 'string') parts.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as ComponentNode);
    return parts.join('\n');
}

function chooseBanner(message: Message): { name: string; path: string } | null {
    if (message.author.id !== message.client.user?.id) return null;
    const text = flattenText(message);
    if (/##\s*(?:🤝\s*)?(?:Partnership Program|Partnership Request|Partnership Approved|Partnership Denied)/i.test(text)) {
        return { name: PARTNERSHIP_BANNER_NAME, path: PARTNERSHIP_BANNER_PATH };
    }
    if (/##\s*📣\s*Paid Advertisement\b/i.test(text)) {
        return { name: PAID_AD_BANNER_NAME, path: PAID_AD_BANNER_PATH };
    }
    return null;
}

function alreadyHasBanner(message: Message, name: string): boolean {
    return message.attachments.some(attachment => attachment.name === name);
}

async function addBanner(message: Message, banner: { name: string; path: string }): Promise<void> {
    if (alreadyHasBanner(message, banner.name)) return;
    const topLevel = message.components.map(component => component.toJSON()) as ComponentNode[];
    const container = topLevel.find(component => component.type === 17 && Array.isArray(component.components));
    if (!container?.components) return;

    const header = new MediaGalleryBuilder()
        .addItems(new MediaGalleryItemBuilder().setURL(`attachment://${banner.name}`))
        .toJSON() as ComponentNode;

    container.components.unshift(header, { type: 14, divider: true, spacing: 1 } as ComponentNode);

    await message.edit({
        components: topLevel as never,
        files: [new AttachmentBuilder(banner.path, { name: banner.name })],
        flags: MessageFlags.IsComponentsV2,
        attachments: Array.from(message.attachments.values()),
    });
}

export function installBannerInjector(client: Client): void {
    if (installed) return;
    installed = true;
    client.on('messageCreate', message => {
        const banner = chooseBanner(message);
        if (!banner) return;
        void addBanner(message, banner).catch(error => {
            logger.warn(`[BannerInjector] Could not add ${banner.name} to ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    logger.info('[BannerInjector] Partnership and paid-ad V2 banner injection enabled.');
}
