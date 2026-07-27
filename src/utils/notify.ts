import { Client, type MessageCreateOptions, EmbedBuilder } from 'discord.js';

export async function sendToChannel(client: Client, channelId: string, content: string | MessageCreateOptions | EmbedBuilder) {
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isSendable()) return;

        if (typeof content === 'string') {
            await channel.send({ content, allowedMentions: { parse: ['users'] } });
            return;
        }

        if (content instanceof EmbedBuilder) {
            await channel.send({ embeds: [content], allowedMentions: { parse: ['users'] } });
            return;
        }

        await channel.send({
            ...content,
            allowedMentions: content.allowedMentions ?? { parse: ['users'] },
        });
    } catch (err) {
        // best-effort
        // console.error('sendToChannel error', err);
    }
}

export default sendToChannel;

