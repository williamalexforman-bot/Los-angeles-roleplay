import { ChatInputCommandInteraction, EmbedBuilder, type CommandInteractionOption } from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { legacyEmbedToV2Message } from './embeds';
import { logger } from './logger';

const SECRET_OPTION_PATTERN = /(token|api.?key|password|passwd|secret|credential|private|internal.?notes?|evidence|proof)/i;
const recordedCommandFailures = new WeakMap<ChatInputCommandInteraction, unknown>();

/** Records a handled operational failure so the central audit still reports Failure. */
export function markSlashCommandFailed(interaction: ChatInputCommandInteraction, error?: unknown): void {
    recordedCommandFailures.set(interaction, error ?? new Error('The command reported an operational failure.'));
}

/** Returns and clears any handled failure recorded by the command implementation. */
export function takeSlashCommandFailure(interaction: ChatInputCommandInteraction): unknown | undefined {
    const failure = recordedCommandFailures.get(interaction);
    recordedCommandFailures.delete(interaction);
    return failure;
}

function serializeOption(option: CommandInteractionOption): unknown {
    if (SECRET_OPTION_PATTERN.test(option.name)) return '[REDACTED]';
    if (option.options?.length) {
        return Object.fromEntries(option.options.map(child => [child.name, serializeOption(child)]));
    }
    if (option.user) return { userId: option.user.id };
    if (option.member && 'id' in option.member) return { memberId: String(option.member.id) };
    if (option.role) return { roleId: option.role.id };
    if (option.channel) return { channelId: option.channel.id };
    if (option.attachment) return { attachmentId: option.attachment.id, name: option.attachment.name };
    return option.value ?? null;
}

function sanitizeFailureMessage(value: string): string {
    return value
        .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/giu, 'mongodb://[REDACTED]@')
        .replace(/\b(?:Bearer\s+|sk-|key-)[A-Za-z0-9._-]{8,}\b/giu, '[REDACTED]')
        .replace(/\b(token|api.?key|password|secret|credential)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
        .slice(0, 900);
}

export function sanitizedCommandOptions(interaction: ChatInputCommandInteraction): string {
    const options = Object.fromEntries(interaction.options.data.map(option => [option.name, serializeOption(option)]));
    const serialized = JSON.stringify(options, null, 2);
    return serialized.length > 1000 ? `${serialized.slice(0, 997)}...` : serialized || '{}';
}

export async function logSlashCommand(
    interaction: ChatInputCommandInteraction,
    startedAt: number,
    success: boolean,
    error?: unknown,
): Promise<void> {
    try {
        const channel = await interaction.client.channels.fetch(CHANNEL_IDS.discordCommandLog).catch(() => null);
        if (!channel?.isSendable()) return;

        let subcommand = 'None';
        try {
            subcommand = interaction.options.getSubcommand(false) || 'None';
        } catch {
            subcommand = 'None';
        }

        const channelLink = interaction.guildId && interaction.channelId
            ? `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`
            : 'Unavailable';
        const failure = error instanceof Error ? error.message : error ? String(error) : '';
        const safeFailure = sanitizeFailureMessage(failure);

        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle(success ? 'Slash Command Completed' : 'Slash Command Failed')
            .setThumbnail(BRAND.logoUrl)
            .addFields(
                { name: 'Command', value: `/${interaction.commandName}`, inline: true },
                { name: 'Subcommand', value: subcommand, inline: true },
                { name: 'Result', value: success ? 'Success' : 'Failure', inline: true },
                { name: 'Execution Time', value: `${Date.now() - startedAt}ms`, inline: true },
                { name: 'User', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                { name: 'User ID', value: interaction.user.id, inline: true },
                { name: 'Channel', value: interaction.channel ? `${interaction.channel}` : 'Direct Message', inline: true },
                { name: 'Options (sanitized)', value: `\`\`\`json\n${sanitizedCommandOptions(interaction)}\n\`\`\`` },
                { name: 'Interaction Location', value: `[Open channel](${channelLink})` },
            )
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        if (!success && safeFailure) embed.addFields({ name: 'Failure', value: safeFailure });

        await channel.send(legacyEmbedToV2Message(embed, { allowedMentions: { parse: [] } }));
    } catch (loggingError) {
        logger.warn(`Slash-command audit log unavailable: ${loggingError instanceof Error ? loggingError.message : 'Unknown error'}`);
    }
}
