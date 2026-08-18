import {
    EmbedBuilder,
    type Message,
    type MessageCreateOptions,
} from 'discord.js';
import prohibitedWords from '../config/prohibitedWords';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { legacyEmbedToV2Message } from '../utils/embeds';

const PROFANITY_LOG_CHANNEL_ID = CHANNEL_IDS.profanityLog;
const RAID_THREAT_LOG_CHANNEL_ID = CHANNEL_IDS.raidThreatLog;
const EMBED_COLOR = 0x3b82f6;
const EMBED_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 10_000;

// Staff application help channel (auto-response)
const STAFF_APPLY_CHANNEL_ID = '1526035041593856182';
// Matches any message asking about applying for staff or how to apply
const STAFF_APPLY_PATTERN = /\b(?:how\s+(?:do|can|to|should)\s+|where\s+(?:do|can)\s+|i\s+wanna|i\s+want\s+to|i\s+need\s+to)\s*(?:apply|become|join|start)\b.{0,60}\b(?:staff|team|mod|admin|application|helper|support)\b/iu;
const staffApplyDedupe = new Set<string>();
const STAFF_APPLY_DEDUPE_TTL_MS = 60 * 60 * 1000; // 1 hour per user
function pruneStaffApplyDedupe(now: number): void {
    if (staffApplyDedupe.size < 10_000) return;
    staffApplyDedupe.clear();
}
function reserveStaffApply(userId: string): boolean {
    const now = Date.now();
    pruneStaffApplyDedupe(now);
    if (staffApplyDedupe.has(userId)) return false;
    staffApplyDedupe.add(userId);
    // Auto-expire after 1 hour
    setTimeout(() => staffApplyDedupe.delete(userId), STAFF_APPLY_DEDUPE_TTL_MS);
    return true;
}

export type RaidThreatConfidence = 'Low' | 'Medium' | 'High';

export interface RaidThreatDetection {
    confidence: RaidThreatConfidence;
    triggerPhrase: string;
}

interface RaidThreatRule {
    confidence: RaidThreatConfidence;
    patterns: readonly RegExp[];
}

const RAID_THREAT_RULES: readonly RaidThreatRule[] = [
    {
        confidence: 'High',
        patterns: [
            /\b(?:let'?s|we(?:'re|\s+are|\s+will|\s+are\s+going\s+to|\s+plan(?:ning)?\s+to)|i(?:'m|\s+am)\s+going\s+to|everyone\s+(?:should|needs?\s+to|go))\s+raid\s+(?:this|the|your)\s+(?:discord\s+)?server\b/iu,
            /\braid\s+(?:this|the|your)\s+(?:discord\s+)?server\s+(?:right\s+now|now|tonight|today|at\s+\d{1,2}(?::\d{2})?)/iu,
            /\b(?:the\s+)?raid\s+(?:is\s+)?(?:underway|happening|starting|started)(?:\s+now)?\b/iu,
            /\b(?:everyone|all\s+of\s+you)\s+(?:join|spam|flood|mass[ -]?ping)\b[^\n]{0,80}\b(?:server|channels?)\b/iu,
            /\b(?:mass[ -]?(?:spam|ping)|spam\s+(?:every|all)\s+channels?|flood\s+(?:every|all)\s+channels?)\s+(?:this|the|your)?\s*(?:discord\s+)?server\b/iu,
            // Extra aggressive patterns for better raid detection
            /\b(?:let'?s|we(?:'re|\s+are)|gonna|going\s+to)\s+(?:crash|destroy|nuke|flood|spam|mass[ -]?ping)\s+(?:this|the|their|a)\s+(?:server|discord|channel)\b/iu,
            /\b(?:ping\s+(?:everyone|here|everyone|all)|@everyone|@here)\s+(?:to\s+)?(?:join|raid|spam|flood)\b/iu,
            /\b(?:nuke|crash|destroy)\s+(?:this|the|their|a)\s+(?:server|discord)\b/iu,
            /\b(?:spam|flood)\s+(?:the|this|their)\s+(?:chat|server|channels|discord)\s+(?:with|using|and)\b/iu,
        ],
    },
    {
        confidence: 'Medium',
        patterns: [
            /\b(?:plan(?:ning)?|organ(?:ize|izing)|coordinate|prepare|getting\s+people)\b[^\n]{0,80}\b(?:a\s+)?raid\b/iu,
            /\b(?:raid|attack)\s+(?:this|the|your)\s+(?:discord\s+)?server\b/iu,
            /\b(?:i(?:'ll|\s+will)|we(?:'ll|\s+will)|gonna|going\s+to)\s+raid\b/iu,
            /\b(?:join|bring|get)\b[^\n]{0,60}\b(?:people|everyone|members?)\b[^\n]{0,60}\b(?:spam|flood|raid|disrupt)\b/iu,
            /\bcoordinated\s+(?:mass\s+)?(?:disruption|attack|spam|harassment)\b/iu,
            // Additional medium-confidence patterns
            /\b(?:mass[ -]?ping|spam\s+ping|ping\s+spam)\b/iu,
            /\b(?:raid|attack)\s+party|raiding\s+(?:time|party|crew)\b/iu,
            /\b(?:discord\s+)?(?:raider|attacker)\s+(?:incoming|coming|arriving)\b/iu,
            /\b(?:ready|prepare|get\s+ready)\s+(?:to|for)\s+(?:raid|attack)\b/iu,
            /\b(?:invite|bring|call)\s+(?:in|more|everyone|people)\s+(?:to\s+)?(?:raid|spam|flood)\b/iu,
        ],
    },
    {
        confidence: 'Low',
        patterns: [
            /\b(?:raid\s+incoming|incoming\s+raid)\b/iu,
            /\b(?:we(?:'re|\s+are)|server\s+is|you(?:'re|\s+are))\s+(?:being\s+)?raided\b/iu,
            /\b(?:someone|they)\s+(?:is|are|said\s+they(?:'re|\s+are|\s+will)|threatened\s+to)\s+raid(?:ing)?\b/iu,
            /\b(?:server\s+raid|raid\s+threat)\b/iu,
            // Additional low-confidence patterns
            /\b(?:dm\s+me|add\s+me|message\s+me)\s+(?:for|to)\s+(?:raid|join|attack)\b/iu,
            /\braid\s+(?:night|day|time|hour)\b/iu,
        ],
    },
];

const profanityLogDedupe = new Map<string, number>();
const raidLogDedupe = new Map<string, number>();

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

/**
 * Detects language that credibly describes a Discord raid or coordinated mass
 * disruption. Generic uses of "raid" are intentionally insufficient.
 */
export function detectRaidThreat(content: string): RaidThreatDetection | null {
    if (!content.trim()) return null;

    // This is a common harmless idiom and must never be the reason for an alert.
    const contentWithoutBenignPhrase = content.replace(/\braid\s+the\s+fridge\b/giu, ' ');

    for (const rule of RAID_THREAT_RULES) {
        for (const pattern of rule.patterns) {
            const match = pattern.exec(contentWithoutBenignPhrase);
            if (match?.[0]) {
                return {
                    confidence: rule.confidence,
                    triggerPhrase: match[0].trim(),
                };
            }
        }
    }

    return null;
}

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
            name: 'LARP Message Moderation',
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

function buildRaidThreatEmbed(message: Message, detection: RaidThreatDetection): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({
            name: 'LARP Safety Monitoring',
            iconURL: message.author.displayAvatarURL(),
        })
        .setTitle('Potential Raid Threat Detected')
        .setThumbnail(BRAND.logoUrl)
        .setDescription('A message may indicate a planned raid or coordinated disruption. Staff review is required; no automatic action has been taken.')
        .addFields(
            { name: 'Author', value: `<@${message.author.id}>`, inline: true },
            { name: 'Discord ID', value: message.author.id, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Confidence', value: detection.confidence, inline: true },
            { name: 'Trigger Phrase', value: detection.triggerPhrase, inline: true },
        );

    addFullMessageFields(embed, message.content);

    return embed
        .addFields(
            { name: 'Message Link', value: `[View message](${messageLink(message)})`, inline: true },
            {
                name: 'Date',
                value: `<t:${Math.floor(message.createdTimestamp / 1_000)}:F>`,
                inline: true,
            },
        )
        .setFooter({ text: EMBED_FOOTER })
        .setTimestamp(message.createdAt);
}

/**
 * Detects if a message is asking for help with applying to staff and replies
 * with the application channel location.
 */
export function detectStaffApplyHelp(content: string): boolean {
    if (!content || content.length > 300) return false;
    return STAFF_APPLY_PATTERN.test(content);
}

/** Handles profanity and raid-threat logging for one Discord message. */
export async function handleMessageModeration(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;

    // Auto-reply when someone asks how to apply for staff
    if (detectStaffApplyHelp(message.content) && reserveStaffApply(message.author.id)) {
        try {
            const replyEmbed = new EmbedBuilder()
                .setColor(0x3b82f6)
                .setAuthor({ name: 'Los Angeles Roleplay', iconURL: message.author.displayAvatarURL() })
                .setTitle('📋 Staff Applications')
                .setDescription(
                    `To apply for staff, head to **<#${STAFF_APPLY_CHANNEL_ID}>** and submit your application there!`,
                )
                .setFooter({ text: EMBED_FOOTER })
                .setTimestamp();
            await message.reply(legacyEmbedToV2Message(replyEmbed, { allowedMentions: { parse: [] } }));
        } catch {
            // best-effort
        }
    }

    const detectedWords = detectProhibitedWords(message.content);
    if (detectedWords.length > 0 && reserveMessage(profanityLogDedupe, message.id)) {
        const sent = await sendToLogChannel(message, PROFANITY_LOG_CHANNEL_ID, legacyEmbedToV2Message(
            buildProfanityEmbed(message, detectedWords), {
            allowedMentions: { parse: [] },
        }));

        if (!sent) profanityLogDedupe.delete(message.id);
    }

    const raidThreat = detectRaidThreat(message.content);
    if (raidThreat && reserveMessage(raidLogDedupe, message.id)) {
        const emergencyRoleId = process.env.EMERGENCY_STAFF_ROLE_ID?.trim();
        const shouldPingEmergencyStaff = raidThreat.confidence === 'High'
            && Boolean(emergencyRoleId?.match(/^\d{17,20}$/u));

        const sent = await sendToLogChannel(message, RAID_THREAT_LOG_CHANNEL_ID, legacyEmbedToV2Message(
            buildRaidThreatEmbed(message, raidThreat), {
            content: shouldPingEmergencyStaff ? `<@&${emergencyRoleId}>` : undefined,
            allowedMentions: shouldPingEmergencyStaff && emergencyRoleId
                ? { roles: [emergencyRoleId] }
                : { parse: [] },
        }));

        if (!sent) raidLogDedupe.delete(message.id);
    }
}

export const messageModeration = handleMessageModeration;

export default handleMessageModeration;
