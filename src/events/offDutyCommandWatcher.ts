import { Client, EmbedBuilder, type Message } from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { resolveDockDiscordIds } from '../services/dockReverseService';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const ACTIVE_SHIFT_ROLE_ID = '1521593407825248360';
const registeredClients = new WeakSet<Client>();

type ComponentTextNode = { content?: unknown; components?: readonly ComponentTextNode[] };

function componentText(message: Message): string[] {
    const values: string[] = [];
    const visit = (node: ComponentTextNode): void => {
        if (typeof node.content === 'string') values.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as ComponentTextNode);
    return values;
}

function fieldValue(message: Message, name: string): string | null {
    const embed = message.embeds.find(item => item.title === 'ER:LC Command Detected');
    const field = embed?.fields.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (field?.value?.trim()) return field.value.trim();
    const prefix = `**${name}**\n`;
    const text = componentText(message).find(value => value.toLowerCase().startsWith(prefix.toLowerCase()));
    return text?.slice(prefix.length).trim() || null;
}

function isCommandLog(message: Message): boolean {
    return message.embeds.some(embed => embed.title === 'ER:LC Command Detected')
        || componentText(message).some(value => value.includes('## ER:LC Command Detected'));
}

function cleanCode(value: string | null): string {
    if (!value) return 'Unknown';
    return value.replace(/^`+|`+$/g, '').trim() || 'Unknown';
}

async function handleCommandLogMessage(client: Client, message: Message): Promise<void> {
    if (!client.user || message.author.id !== client.user.id) return;
    if (message.channelId !== CHANNEL_IDS.erlcCommandLog) return;
    if (!message.guild) return;
    if (!isCommandLog(message)) return;

    const robloxId = fieldValue(message, 'Roblox ID');
    if (!robloxId || !/^\d+$/.test(robloxId)) return;

    const lookup = await resolveDockDiscordIds(message.guild.id, robloxId);
    if (!lookup.ok) {
        logger.warn(`[OffDuty] Dock reverse lookup skipped for Roblox ${robloxId}: ${lookup.status}.`);
        return;
    }

    const uniqueDiscordIds = Array.from(new Set(lookup.discordIds));
    const members = await Promise.all(
        uniqueDiscordIds.map(id => message.guild!.members.fetch(id).catch(() => null)),
    );

    // The Active Shift role is the live source of truth. Break and ended shifts
    // do not have this role, so commands used in those states are off duty.
    if (members.some(member => member?.roles.cache.has(ACTIVE_SHIFT_ROLE_ID))) return;

    const playerName = fieldValue(message, 'Roblox Player') || 'Unknown';
    const command = cleanCode(fieldValue(message, 'Command'));
    const executed = fieldValue(message, 'Executed') || `<t:${Math.floor(message.createdTimestamp / 1_000)}:F>`;
    const linkedUsers = uniqueDiscordIds.map(id => `<@${id}>`).join(' • ');

    const alert = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('🚨 OFF DUTY COMMAND')
        .setDescription('An ER:LC command was used while the Dock-linked Discord member was not on an active staff shift.')
        .addFields(
            { name: 'Shift Status', value: '🔴 **OFF DUTY**', inline: true },
            { name: 'Roblox Player', value: playerName, inline: true },
            { name: 'Roblox ID', value: robloxId, inline: true },
            { name: 'Discord Account', value: linkedUsers || 'Unavailable' },
            { name: 'Command Used', value: `\`${command.replace(/`/g, 'ˋ').slice(0, 1_000)}\`` },
            { name: 'Executed', value: executed, inline: true },
            { name: 'Original Command Log', value: `[Jump to message](${message.url})`, inline: true },
        )
        .setFooter({ text: `${BRAND.footer} | Off Duty Command` })
        .setTimestamp(message.createdAt);

    const destination = await client.channels.fetch(CHANNEL_IDS.erlcCommandLog).catch(() => null);
    if (!destination?.isSendable()) {
        logger.warn(`[OffDuty] Command log channel ${CHANNEL_IDS.erlcCommandLog} is unavailable.`);
        return;
    }

    await destination.send(legacyEmbedToV2Message(alert, {
        allowedMentions: { parse: [] },
    })).catch(error => {
        logger.warn(`[OffDuty] Could not post off-duty command alert: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

/**
 * Watches the bot's existing ER:LC command-log messages. This reuses the
 * current ER:LC monitor instead of creating a second API poller.
 */
export function registerOffDutyCommandWatcher(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on('messageCreate', message => {
        void handleCommandLogMessage(client, message).catch(error => {
            logger.warn(`[OffDuty] Command watcher failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
}
