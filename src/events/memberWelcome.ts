import { Client, Events, type GuildMember } from 'discord.js';
import { logger } from '../utils/logger';

const WELCOME_CHANNEL_ID = '1526037215518523462';
const registeredClients = new WeakSet<Client>();

async function getFreshMemberCount(member: GuildMember): Promise<number> {
    try {
        const freshGuild = await member.client.guilds.fetch({ guild: member.guild.id, force: true });
        if (typeof freshGuild.memberCount === 'number' && freshGuild.memberCount > 0) {
            return freshGuild.memberCount;
        }
    } catch {
        // Fall back to the GuildMember event's guild snapshot below.
    }

    return member.guild.memberCount || member.guild.members.cache.size;
}

async function resolveWelcomeChannel(client: Client) {
    const cached = client.channels.cache.get(WELCOME_CHANNEL_ID);
    if (cached?.isSendable()) return cached;

    const fetched = await client.channels.fetch(WELCOME_CHANNEL_ID, { force: true }).catch(() => null);
    return fetched?.isSendable() ? fetched : null;
}

async function sendWelcome(member: GuildMember): Promise<void> {
    if (member.user.bot) return;

    const channel = await resolveWelcomeChannel(member.client);
    if (!channel) {
        logger.error(`[Welcome] Channel ${WELCOME_CHANNEL_ID} could not be fetched or the bot cannot send messages there.`);
        return;
    }

    const memberCount = await getFreshMemberCount(member);
    const content = `🌴 Welcome <@${member.id}> to Los Angeles Roleplay! You are the ${memberCount} member. We hope you enjoy your time here!`;

    await channel.send({
        content,
        allowedMentions: {
            parse: [],
            users: [member.id],
            roles: [],
            repliedUser: false,
        },
    });

    logger.info(`[Welcome] Sent public welcome for ${member.user.tag} (${member.id}); memberCount=${memberCount}.`);
}

async function verifyWelcomeChannel(client: Client): Promise<void> {
    const channel = await resolveWelcomeChannel(client);
    if (!channel) {
        logger.error(`[Welcome] STARTUP CHECK FAILED: channel ${WELCOME_CHANNEL_ID} is unavailable or not sendable. Check View Channel and Send Messages permissions.`);
        return;
    }

    logger.info(`[Welcome] STARTUP CHECK PASSED: channel ${WELCOME_CHANNEL_ID} is reachable and sendable.`);
}

export function registerMemberWelcome(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.GuildMemberAdd, member => {
        logger.info(`[Welcome] GuildMemberAdd received for ${member.user.tag} (${member.id}) in guild ${member.guild.id}.`);
        void sendWelcome(member).catch(error => {
            logger.error(`[Welcome] Failed to welcome ${member.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
    });

    void verifyWelcomeChannel(client).catch(error => {
        logger.error(`[Welcome] Startup verification failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    logger.info(`[Welcome] Plain-text member welcome listener enabled for ${WELCOME_CHANNEL_ID}.`);
}
