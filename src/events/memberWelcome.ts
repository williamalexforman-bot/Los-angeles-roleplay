import { ChannelType, Client, Events, type GuildMember, type TextChannel } from 'discord.js';
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

async function sendWelcome(member: GuildMember): Promise<void> {
    if (member.user.bot) return;

    const channel = await member.client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        logger.warn(`[Welcome] Channel ${WELCOME_CHANNEL_ID} is unavailable or is not a text channel.`);
        return;
    }

    const memberCount = await getFreshMemberCount(member);
    const content = `🌴 Welcome <@${member.id}> to Los Angeles Roleplay! You are the ${memberCount} member. We hope you enjoy your time here!`;

    await (channel as TextChannel).send({
        content,
        allowedMentions: {
            parse: [],
            users: [member.id],
            roles: [],
            repliedUser: false,
        },
    });

    logger.info(`[Welcome] Welcomed ${member.user.tag} (${member.id}) as member ${memberCount}.`);
}

export function registerMemberWelcome(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.GuildMemberAdd, member => {
        void sendWelcome(member).catch(error => {
            logger.warn(`[Welcome] Failed to welcome ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
    });

    logger.info(`[Welcome] Plain-text member welcome enabled in ${WELCOME_CHANNEL_ID}.`);
}
