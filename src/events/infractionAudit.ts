import {
    ChannelType,
    Client,
    EmbedBuilder,
    Events,
    type ChatInputCommandInteraction,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const registeredClients = new WeakSet<Client>();
const VERIFY_DELAY_MS = 2_500;

function commandIsInfractionIssue(interaction: ChatInputCommandInteraction): boolean {
    if (interaction.commandName !== 'infraction') return false;
    try {
        return interaction.options.getSubcommand(false) === 'issue';
    } catch {
        return false;
    }
}

function messageText(message: Message): string {
    const output: string[] = [message.content || ''];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.content === 'string') output.push(record.content);
        if (Array.isArray(record.components)) record.components.forEach(visit);
        if (Array.isArray(record.items)) record.items.forEach(visit);
    };
    for (const component of message.components) visit(component.toJSON());
    for (const embed of message.embeds) {
        if (embed.title) output.push(embed.title);
        if (embed.description) output.push(embed.description);
        for (const field of embed.fields) output.push(field.name, field.value);
    }
    return output.join('\n');
}

async function resolveInfractionChannel(client: Client): Promise<TextChannel | null> {
    const channel = await client.channels.fetch(CHANNEL_IDS.infractionParent).catch(error => {
        logger.error(`[InfractionAudit] Could not fetch configured infraction channel ${CHANNEL_IDS.infractionParent}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    });
    return channel?.type === ChannelType.GuildText ? channel : null;
}

async function caseAlreadyLogged(
    channel: TextChannel,
    memberId: string,
    issuerId: string,
    reason: string,
): Promise<boolean> {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!recent) return false;
    const reasonNeedle = reason.trim().toLowerCase().slice(0, 80);
    return recent.some(message => {
        if (message.author.id !== channel.client.user?.id) return false;
        const text = messageText(message).toLowerCase();
        if (!text.includes(memberId) || !text.includes(issuerId)) return false;
        return !reasonNeedle || text.includes(reasonNeedle);
    });
}

async function verifyInfractionLog(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getUser('member');
    const action = interaction.options.getString('action') || 'Unknown';
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const notes = interaction.options.getString('notes') || 'No notes provided.';
    const evidence = interaction.options.getString('evidence') || 'No evidence supplied.';
    if (!member) return;

    const channel = await resolveInfractionChannel(interaction.client);
    if (!channel) {
        logger.error(`[InfractionAudit] /infraction issue by ${interaction.user.id} could not be logged because configured channel ${CHANNEL_IDS.infractionParent} is unavailable.`);
        return;
    }

    if (await caseAlreadyLogged(channel, member.id, interaction.user.id, reason)) {
        logger.info(`[InfractionAudit] Verified visible infraction log for ${member.id}.`);
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setAuthor({ name: 'Los Angeles Roleplay | Infraction Audit' })
        .setTitle(`⚠️ Infraction Log Recovery | ${action}`)
        .setDescription('The normal infraction case panel was not detected after the command completed, so this recovery log was created automatically. Staff should review the bot logs if the case thread is also missing.')
        .addFields(
            { name: 'Member', value: `<@${member.id}> (${member.id})`, inline: true },
            { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Action', value: action, inline: true },
            { name: 'Reason', value: reason.slice(0, 1024) },
            { name: 'Notes', value: notes.slice(0, 1024) },
            { name: 'Evidence', value: evidence.slice(0, 1024) },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();

    await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
    }).then(message => {
        logger.warn(`[InfractionAudit] Normal case log was missing; recovery log ${message.id} created in ${channel.id}.`);
    }).catch(error => {
        logger.error(`[InfractionAudit] Recovery log send failed in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

export function registerInfractionAudit(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.InteractionCreate, interaction => {
        if (!interaction.isChatInputCommand() || !commandIsInfractionIssue(interaction)) return;
        const timer = setTimeout(() => {
            void verifyInfractionLog(interaction).catch(error => {
                logger.error(`[InfractionAudit] Verification failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            });
        }, VERIFY_DELAY_MS);
        timer.unref?.();
    });

    logger.info(`[InfractionAudit] Visible infraction logging verification enabled for channel ${CHANNEL_IDS.infractionParent}.`);
}
