import { Client, Events, Message } from 'discord.js';
import { logger } from '../utils/logger';

const DUCK_USER_ID = '1262469782897295461';
const WATCHED_ROLE_ID = '1521593407791825036';
const WHITELIST_ROLE_ID = '1521598108226818288';
const WARNING_TEXT = 'Stop pinging Duck. He has told you many times if you continue to ping it will result in an infraction.';

const registeredClients = new WeakSet<Client>();

async function handleDuckPing(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (!message.mentions.users.has(DUCK_USER_ID)) return;

    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    // Only members with the watched role receive the warning.
    if (!member.roles.cache.has(WATCHED_ROLE_ID)) return;

    // Whitelisted members may ping Duck without the automatic warning.
    if (member.roles.cache.has(WHITELIST_ROLE_ID)) return;

    await message.reply({
        content: WARNING_TEXT,
        allowedMentions: { parse: [], repliedUser: false },
    }).catch(error => {
        logger.warn(`[DuckPingProtection] Could not reply to ${message.author.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

export function registerDuckPingProtection(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.MessageCreate, message => {
        void handleDuckPing(message).catch(error => {
            logger.warn(`[DuckPingProtection] Handler failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });

    logger.info(`[DuckPingProtection] Enabled for user ${DUCK_USER_ID}; watched role=${WATCHED_ROLE_ID}; whitelist=${WHITELIST_ROLE_ID}.`);
}
