import {
    EmbedBuilder,
    MessageFlags,
    type Message,
    type MessageCreateOptions,
} from 'discord.js';
import prohibitedWords from '../config/prohibitedWords';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { embedsToV2 } from '../utils/componentsV2';

const EMBED_COLOR = 0xfacc15;
const EMBED_FOOTER = 'California State Roleplay | Realism at its Finest';
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 10_000;

const profanityLogDedupe = new Map<string, number>();

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prohibitedWordPattern(word: string): RegExp | null {
    const normalized = word.trim();
    if (!normalized) return null;

    const escaped = normalized
        .split(/\s+/u)
        .map(escapeRegExp)
        .join('\\s+');

    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * Returns each configured prohibited term found as a whole word. The function
 * is pure so configuration and boundary behavior can be unit tested directly.
 */
export function detectProhibitedWords(
    content: string,
    configuredWords: readonly string[] = prohibitedWords,
): string[] {
    if (!content || configuredWords.length === 0) return [];

    const matches: string[] = [];
    const seen = new Set<string>();

    for (const configuredWord of configuredWords) {
        const normalized = configuredWord.trim().toLocaleLowerCase();
        if (!normalized || seen.has(normalized)) continue;

        const pattern = prohibitedWordPattern(configuredWord);
        if (pattern?.test(content)) {
            matches.push(configuredWord.trim());
            seen.add(normalized);
        }
    }

    return matches;
}

export const findProhibitedWords = detectProhibitedWords;

function pruneDedupe(cache: Map<string, number>, now: number): void {
    if (cache.size < MAX_DEDUPE_ENTRIES) return;

    for (const [messageId, recordedAt] of cache) {
        if (now - recordedAt > DEDUPE_TTL_MS || cache.size >= MAX_DEDUPE_ENTRIES) {
            cache.delete(messageId);
        }

        if (cache.size < MAX_DEDUPE_ENTRIES) break;
    }
}

function reserveMessage(cache: Map<string, number>, messageId: string): boolean {
    if (cache.has(messageId)) return false;

    const now = Date.now();
    pruneDedupe(cache, now);
    cache.set(messageId, now);
    return true;
}

function splitEmbedFieldValue(value: string, maximumLength = 1_000): string[] {
    const safeValue = value || '*No text content*';
    const chunks: string[] = [];

    for (let offset = 0; offset < safeValue.length; offset += maximumLength) {
        chunks.push(safeValue.slice(offset, offset + maximumLength));
    }

    return chunks;
}

function addFullMessageFields(embed: EmbedBuilder, content: string): void {
    splitEmbedFieldValue(content).forEach((chunk, index) => {
        embed.addFields({
            name: index === 0 ? 'Full Original Message' : 'Full Original Message (continued)',
            value: chunk,
            inline: false,
        });
    });
}

function messageLink(message: Message): string {
    return message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

async function sendToLogChannel(
    message: Message,
    channelId: string,
    payload: MessageCreateOptions,
): Promise<boolean> {
    try {
        const channel = await message.client.channels.fetch(channelId);
        if (!channel?.isSendable()) return false;

        await channel.send(payload);
        return true;
    } catch {
        return false;
    }
}

function buildProfanityEmbed(message: Message, detectedWords: readonly string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({
            name: 'CSRP Message Moderation',
            iconURL: message.author.displayAvatarURL(),
        })
        .setTitle('Prohibited Language Detected')
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Member', value: `<@${message.author.id}>`, inline: true },
            { name: 'Discord ID', value: message.author.id, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Detected Word', value: detectedWords.join(', '), inline: false },
        );

    addFullMessageFields(embed, message.content);

    return embed
        .addFields(
            { name: 'Message Link', value: `[View message](${messageLink(message)})`, inline: true },
            {
                name: 'Date and Time',
                value: `<t:${Math.floor(message.createdTimestamp / 1_000)}:F>`,
                inline: true,
            },
        )
        .setFooter({ text: EMBED_FOOTER })
        .setTimestamp(message.createdAt);
}

/** Handles prohibited-language logging for one Discord message. */
export async function handleMessageModeration(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const detectedWords = detectProhibitedWords(message.content);
    if (detectedWords.length > 0 && reserveMessage(profanityLogDedupe, message.id)) {
        const sent = await sendToLogChannel(message, CHANNEL_IDS.profanityLog, {
            components: embedsToV2([buildProfanityEmbed(message, detectedWords)]),
            files: [createLogoAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });

        if (!sent) profanityLogDedupe.delete(message.id);
    }
}

export const messageModeration = handleMessageModeration;

export default handleMessageModeration;
