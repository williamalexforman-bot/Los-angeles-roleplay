import { Client, Events, MessageFlags, TextChannel, type Message } from 'discord.js';
import { logger } from '../utils/logger';

const INFRACTION_PARENT_CHANNEL_ID = '1526044664975851642';
const APPEAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_RESCAN_MS = 60 * 60 * 1000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let registered = false;

type JsonNode = {
    custom_id?: string;
    label?: string;
    disabled?: boolean;
    components?: JsonNode[];
};

function containsAppealButton(message: Message): boolean {
    const serialized = JSON.stringify(message.components.map(component => component.toJSON()));
    return serialized.includes('infraction-appeal:start:');
}

function disableAppealButton(nodes: JsonNode[]): boolean {
    let changed = false;
    for (const node of nodes) {
        if (typeof node.custom_id === 'string' && node.custom_id.startsWith('infraction-appeal:start:')) {
            if (!node.disabled || node.label !== 'Appeal Window Closed') {
                node.disabled = true;
                node.label = 'Appeal Window Closed';
                changed = true;
            }
        }
        if (Array.isArray(node.components) && disableAppealButton(node.components)) changed = true;
    }
    return changed;
}

async function expireMessage(message: Message): Promise<void> {
    if (!containsAppealButton(message)) return;
    const components = message.components.map(component => component.toJSON()) as unknown as JsonNode[];
    if (!disableAppealButton(components)) return;

    try {
        await message.edit({
            components: components as never,
            flags: MessageFlags.IsComponentsV2,
            attachments: Array.from(message.attachments.values()),
        });
        logger.info(`[InfractionAppeal] Disabled expired appeal button on message ${message.id}.`);
    } catch (error) {
        logger.warn(`[InfractionAppeal] Could not disable expired appeal button on ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function scheduleMessage(message: Message): void {
    if (message.channelId !== INFRACTION_PARENT_CHANNEL_ID || !containsAppealButton(message)) return;
    if (timers.has(message.id)) return;

    const remaining = message.createdTimestamp + APPEAL_WINDOW_MS - Date.now();
    if (remaining <= 0) {
        void expireMessage(message);
        return;
    }

    const timer = setTimeout(() => {
        timers.delete(message.id);
        void expireMessage(message);
    }, remaining);
    timer.unref?.();
    timers.set(message.id, timer);
}

async function scheduleExisting(client: Client): Promise<void> {
    const channel = await client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    if (!(channel instanceof TextChannel)) return;

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;
    for (const message of messages.values()) scheduleMessage(message);
}

export function registerInfractionAppealExpiry(client: Client): void {
    if (registered) return;
    registered = true;

    client.on(Events.MessageCreate, message => {
        scheduleMessage(message);
    });

    void scheduleExisting(client).catch(error => {
        logger.warn(`[InfractionAppeal] Could not schedule existing appeal expirations: ${error instanceof Error ? error.message : String(error)}`);
    });

    const safetyRescan = setInterval(() => {
        void scheduleExisting(client).catch(error => {
            logger.warn(`[InfractionAppeal] Safety rescan failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, SAFETY_RESCAN_MS);
    safetyRescan.unref?.();

    logger.info('[InfractionAppeal] 24-hour appeal expiry watcher enabled.');
}
