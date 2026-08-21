import { Client, EmbedBuilder } from 'discord.js';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';
import { registerMemberWelcome } from './memberWelcome';

const registeredClients = new WeakSet<Client>();
const DEFAULT_JOIN_LOG_CHANNEL_ID = '1529283685168447698';

export function registerJoinAccountDateCorrection(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    // Register the separate plain-text public welcome message exactly once.
    registerMemberWelcome(client);

    client.on('guildMemberAdd', member => {
        void (async () => {
            // The existing join logger runs first. Give it a moment to post,
            // then correct its Account Created field using discord.js's own
            // User.createdTimestamp value rather than manual snowflake math.
            await new Promise(resolve => setTimeout(resolve, 700));
            const channelId = process.env.JOIN_LOG_CHANNEL_ID || DEFAULT_JOIN_LOG_CHANNEL_ID;
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased() || !('messages' in channel) || !client.user) return;

            const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
            if (!recent) return;
            const message = recent.find(candidate =>
                candidate.author.id === client.user!.id
                && candidate.embeds.some(embed =>
                    embed.title === 'Member Joined'
                    && (embed.description || '').includes(member.id)
                )
            );
            if (!message) return;

            const source = message.embeds.find(embed => embed.title === 'Member Joined');
            if (!source) return;
            const created = Math.floor(member.user.createdTimestamp / 1_000);
            const corrected = EmbedBuilder.from(source);
            const fields = source.fields.map(field => ({ ...field }));
            const index = fields.findIndex(field => field.name === 'Account Created');
            const replacement = {
                name: 'Account Created',
                value: `<t:${created}:F> • <t:${created}:R>`,
                inline: true,
            };
            if (index >= 0) fields[index] = replacement;
            else fields.push(replacement);
            corrected.setFields(fields);

            await message.edit({
                ...legacyEmbedToV2Message(corrected),
                content: null,
                embeds: [],
                attachments: [],
            });
        })().catch(error => {
            logger.warn(`[JoinLog] Could not correct account creation date: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    });
}
