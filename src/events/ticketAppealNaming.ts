import { ChannelType, Client, type Message, type TextChannel } from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const registeredClients = new WeakSet<Client>();

type RawComponent = {
    content?: unknown;
    components?: RawComponent[];
};

function componentText(message: Message): string {
    const output: string[] = [];
    const visit = (node: RawComponent): void => {
        if (typeof node.content === 'string') output.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as RawComponent);
    return output.join('\n');
}

function openingReason(message: Message): string {
    const lines = componentText(message).split(/\r?\n/);
    const labels = ['Reason for Opening Ticket', 'Reason for Report'];
    for (const label of labels) {
        const headingIndex = lines.findIndex(line => line.trim().toLowerCase() === `### ${label}`.toLowerCase());
        if (headingIndex < 0) continue;
        const collected: string[] = [];
        for (let index = headingIndex + 1; index < lines.length; index += 1) {
            const line = lines[index].trim();
            if (!line || line === '```') continue;
            if (line.startsWith('### ')) break;
            collected.push(line);
        }
        if (collected.length) return collected.join(' ').trim();
    }
    return '';
}

function isAppeal(reason: string): boolean {
    return /\bappeal(?:ing|ed|s)?\b/i.test(reason)
        || /\b(?:ban|warning|warn|strike|suspension|demotion|infraction)\b.{0,35}\b(?:remove|revoke|contest|dispute)\b/i.test(reason);
}

async function forceAppealName(channel: TextChannel, panel: Message): Promise<void> {
    if (!channel.topic?.startsWith(TICKET_TOPIC_PREFIX)) return;
    const reason = openingReason(panel);
    if (!reason || !isAppeal(reason)) return;

    // Allow the general priority classifier to finish first, then make the
    // server's appeal naming rule authoritative. Every kind of infraction
    // appeal uses one short channel name rather than ban-appeal/warning-appeal.
    await new Promise(resolve => setTimeout(resolve, 1200));
    const refreshed = await channel.fetch().catch(() => channel);
    if (refreshed.type !== ChannelType.GuildText || refreshed.name === '🟢-appeal') return;
    await refreshed.setName('🟢-appeal', 'All infraction appeals use the generic appeal ticket name.').catch(error => {
        logger.warn(`[Ticket Appeal Naming] Could not rename ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

export function registerTicketAppealNaming(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('messageCreate', message => {
        if (message.author.id !== client.user?.id || message.channel.type !== ChannelType.GuildText) return;
        if (!message.channel.topic?.startsWith(TICKET_TOPIC_PREFIX)) return;
        if (!componentText(message).includes('Ticket')) return;
        void forceAppealName(message.channel, message).catch(error => {
            logger.warn(`[Ticket Appeal Naming] Override failed for ${message.channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });

    logger.info('[Ticket Appeal Naming] Generic 🟢-appeal naming enabled.');
}
