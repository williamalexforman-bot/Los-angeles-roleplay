import {
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    TextDisplayBuilder,
    type APIEmbed,
    type ActionRowBuilder,
    type EmbedBuilder,
    type MessageActionRowComponentBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';

type EmbedLike = EmbedBuilder | APIEmbed;

export function embedToV2(embed: EmbedLike, rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []): ContainerBuilder {
    const data = 'toJSON' in embed ? embed.toJSON() : embed;
    const lines: string[] = [];
    if (data.title) lines.push(`# ${data.title}`);
    if (data.description) lines.push(data.description);
    for (const field of data.fields || []) {
        lines.push('', `**${field.name}**`, field.value);
    }
    if (data.footer?.text) lines.push('', `-# ${data.footer.text}`);
    if (data.timestamp) lines.push(`-# <t:${Math.floor(new Date(data.timestamp).getTime() / 1_000)}:f>`);
    const container = new ContainerBuilder();
    if (data.image?.url) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(data.image.url)));
    if (lines.length) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 4000)));
    if (rows.length) container.addActionRowComponents(...rows);
    return container;
}

export function embedsToV2(embeds: EmbedLike[], rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []): ContainerBuilder[] {
    return embeds.map((embed, index) => embedToV2(embed, index === embeds.length - 1 ? rows : []));
}
