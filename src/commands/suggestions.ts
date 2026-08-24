import { randomInt } from 'node:crypto';
import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    type Message,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { Suggestion, type SuggestionRecord, type SuggestionStatus } from '../database/suggestionModel';
import { CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const SUGGESTION_CHANNEL_ID = CHANNEL_IDS.suggestions;
const PANEL_COLOR = 0x247bf1;
const SUGGESTION_BANNER_NAME = 'suggestion-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const SUGGESTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', SUGGESTION_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const inMemorySuggestions = new Map<string, SuggestionRecord>();
type VoteDirection = 'up' | 'down';

function artwork(): AttachmentBuilder[] {
    return [new AttachmentBuilder(SUGGESTION_BANNER_PATH, { name: SUGGESTION_BANNER_NAME }), new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME })];
}
function gallery(name: string): MediaGalleryBuilder { return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)); }
function divider(): SeparatorBuilder { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function statusLabel(status: SuggestionStatus): string { if (status === 'Approved') return '✅ Approved'; if (status === 'Denied') return '❌ Denied'; if (status === 'Maybe') return '🟡 Maybe / Under Consideration'; return '🕒 Pending Review'; }
function statusColor(status: SuggestionStatus): number { if (status === 'Approved') return 0x22c55e; if (status === 'Denied') return 0xef4444; if (status === 'Maybe') return 0xf59e0b; return PANEL_COLOR; }
function votingOpen(status: SuggestionStatus): boolean { return status === 'Pending' || status === 'Maybe'; }
function cacheSuggestion(record: SuggestionRecord): SuggestionRecord { const cached = { ...record, upvotes: [...record.upvotes], downvotes: [...record.downvotes] }; inMemorySuggestions.set(cached.suggestionId, cached); return cached; }
async function findSuggestion(suggestionId: string, guildId?: string | null): Promise<SuggestionRecord | null> { if (isDatabaseAvailable()) { const query: { suggestionId: string; guildId?: string } = { suggestionId }; if (guildId) query.guildId = guildId; const stored = await Suggestion.findOne(query).lean().exec().catch(() => null); if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord); } const cached = inMemorySuggestions.get(suggestionId) || null; return cached && (!guildId || cached.guildId === guildId) ? cached : null; }
function suggestionComponentText(message: Pick<Message, 'components'>): string[] {
    const output: string[] = [];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.content === 'string') output.push(record.content);
        if (Array.isArray(record.components)) record.components.forEach(visit);
        if (Array.isArray(record.items)) record.items.forEach(visit);
    };
    for (const component of message.components) visit(component.toJSON());
    return output;
}
function recoverSuggestionFromMessage(message: Message, guildId: string): SuggestionRecord | null {
    const blocks = suggestionComponentText(message);
    const header = blocks.find(block => block.includes('**Suggestion ID:**')) || '';
    const body = blocks.find(block => block.includes('**Community Votes:**')) || '';
    const suggestionId = header.match(/\*\*Suggestion ID:\*\*\s*`(\d{8})`/u)?.[1];
    const author = header.match(/\*\*Submitted By:\*\*\s*<@(\d+)>\s*•\s*`([^`]+)`/u);
    if (!suggestionId || !author) return null;

    const status: SuggestionStatus = header.includes('Approved')
        ? 'Approved'
        : header.includes('Denied')
            ? 'Denied'
            : header.includes('Maybe') || header.includes('Under Consideration')
                ? 'Maybe'
                : 'Pending';
    const content = body
        .replace(/^\*\*Suggestion\*\*\s*/u, '')
        .replace(/`{3,4}\s*/u, '')
        .replace(/\s*`{3,4}\s*\*\*Community Votes:\*\*[\s\S]*$/u, '')
        .trim();
    const votes = body.match(/👍\s*(\d+)\s*•\s*👎\s*(\d+)/u);
    const upvoteCount = Number(votes?.[1] || 0);
    const downvoteCount = Number(votes?.[2] || 0);
    const createdSeconds = Number(header.match(/\*\*Submitted:\*\*\s*<t:(\d+):/u)?.[1]);
    const decision = blocks.find(block => block.includes('**Owner Decision:**')) || '';
    const decidedById = decision.match(/\*\*Updated By:\*\*\s*<@(\d+)>/u)?.[1];
    const decidedSeconds = Number(decision.match(/<t:(\d+):/u)?.[1]);
    const createdAt = Number.isFinite(createdSeconds) && createdSeconds > 0
        ? new Date(createdSeconds * 1_000)
        : new Date(message.createdTimestamp || Date.now());

    return cacheSuggestion({
        suggestionId,
        guildId,
        userId: author[1],
        discordUsername: author[2],
        content: content || 'Suggestion details could not be recovered.',
        status,
        upvotes: Array.from({ length: upvoteCount }, (_, index) => `recovered-upvote-${index}`),
        downvotes: Array.from({ length: downvoteCount }, (_, index) => `recovered-downvote-${index}`),
        channelId: message.channelId || SUGGESTION_CHANNEL_ID,
        messageId: message.id,
        createdAt,
        updatedAt: new Date(),
        ...(decidedById ? { decidedById } : {}),
        ...(Number.isFinite(decidedSeconds) && decidedSeconds > 0 ? { decidedAt: new Date(decidedSeconds * 1_000) } : {}),
    });
}
async function recoverSuggestionFromChannel(
    client: ChatInputCommandInteraction['client'],
    suggestionId: string,
    guildId: string,
): Promise<SuggestionRecord | null> {
    const channel = await client.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return null;
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!batch?.size) return null;
        for (const message of batch.values()) {
            if (!suggestionComponentText(message).some(block => block.includes(`\`${suggestionId}\``))) continue;
            const recovered = recoverSuggestionFromMessage(message, guildId);
            if (recovered?.suggestionId === suggestionId) return recovered;
        }
        if (batch.size < 100) return null;
        const oldest = batch.last();
        if (!oldest || oldest.id === before) return null;
        before = oldest.id;
    }
    return null;
}
async function createSuggestion(record: SuggestionRecord): Promise<SuggestionRecord> { if (isDatabaseAvailable()) { try { const document = await Suggestion.create(record); return cacheSuggestion(document.toObject() as SuggestionRecord); } catch (error) { logger.warn(`[Suggestions] MongoDB create failed for ${record.suggestionId}; using the in-memory fallback: ${error instanceof Error ? error.message : 'Unknown error'}`); } } return cacheSuggestion(record); }
async function saveSuggestionMessageId(record: SuggestionRecord, messageId: string): Promise<SuggestionRecord> { const updated = cacheSuggestion({ ...record, messageId, updatedAt: new Date() }); if (!isDatabaseAvailable()) return updated; const stored = await Suggestion.findOneAndUpdate({ suggestionId: record.suggestionId }, { $set: { messageId, updatedAt: updated.updatedAt } }, { new: true }).lean().exec().catch(() => null); return stored ? cacheSuggestion(stored as unknown as SuggestionRecord) : updated; }
async function removeSuggestion(suggestionId: string): Promise<void> { inMemorySuggestions.delete(suggestionId); if (isDatabaseAvailable()) await Suggestion.deleteOne({ suggestionId }).exec().catch(() => undefined); }
async function saveSuggestionVotes(record: SuggestionRecord, upvotes: string[], downvotes: string[]): Promise<SuggestionRecord | null> { if (!votingOpen(record.status)) return null; const updatedAt = new Date(); if (isDatabaseAvailable()) { const stored = await Suggestion.findOneAndUpdate({ suggestionId: record.suggestionId, status: { $in: ['Pending', 'Maybe'] } }, { $set: { upvotes, downvotes, updatedAt } }, { new: true }).lean().exec().catch(() => null); if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord); } const current = inMemorySuggestions.get(record.suggestionId); if (!current || !votingOpen(current.status)) return null; return cacheSuggestion({ ...current, upvotes, downvotes, updatedAt }); }
async function saveSuggestionDecision(suggestionId: string, guildId: string | null, status: Exclude<SuggestionStatus, 'Pending'>, decidedById: string): Promise<SuggestionRecord | null> { const decidedAt = new Date(); if (isDatabaseAvailable()) { const stored = await Suggestion.findOneAndUpdate({ suggestionId, guildId }, { $set: { status, decidedAt, decidedById, updatedAt: decidedAt } }, { new: true }).lean().exec().catch(() => null); if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord); } const current = inMemorySuggestions.get(suggestionId); if (!current || current.guildId !== guildId) return null; return cacheSuggestion({ ...current, status, decidedAt, decidedById, updatedAt: decidedAt }); }
function voteRow(record: SuggestionRecord): ActionRowBuilder<ButtonBuilder> { const disabled = !votingOpen(record.status); return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`suggestion:vote:up:${record.suggestionId}`).setLabel(`Upvote • ${record.upvotes.length}`).setEmoji('👍').setStyle(ButtonStyle.Success).setDisabled(disabled), new ButtonBuilder().setCustomId(`suggestion:vote:down:${record.suggestionId}`).setLabel(`Downvote • ${record.downvotes.length}`).setEmoji('👎').setStyle(ButtonStyle.Danger).setDisabled(disabled)); }
function suggestionPanel(record: SuggestionRecord): ContainerBuilder { const created = Math.floor(new Date(record.createdAt).getTime() / 1000); const voteTotal = record.upvotes.length + record.downvotes.length; const score = record.upvotes.length - record.downvotes.length; const safeSuggestion = record.content.replace(/```/g, "'''").slice(0, 1800); const panel = new ContainerBuilder().setAccentColor(statusColor(record.status)).addMediaGalleryComponents(gallery(SUGGESTION_BANNER_NAME)).addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(['## 💡 Community Suggestion',`**Suggestion ID:** \`${record.suggestionId}\``,`**Submitted By:** <@${record.userId}> • \`${record.discordUsername}\``,`**Status:** ${statusLabel(record.status)}`,`**Submitted:** <t:${created}:F> • <t:${created}:R>`].join('\n'))).addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(['**Suggestion**',`\`\`\`\n${safeSuggestion}\n\`\`\``,`**Community Votes:** 👍 ${record.upvotes.length} • 👎 ${record.downvotes.length} • **Score:** ${score >= 0 ? '+' : ''}${score} • **Total:** ${voteTotal}`].join('\n'))).addActionRowComponents(voteRow(record)).addSeparatorComponents(divider()); if (record.decidedAt && record.decidedById) { const decided = Math.floor(new Date(record.decidedAt).getTime() / 1000); panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Owner Decision:** ${statusLabel(record.status)}\n**Updated By:** <@${record.decidedById}> • <t:${decided}:R>`)); } return panel.addSeparatorComponents(divider()).addMediaGalleryComponents(gallery(UNDERBANNER_NAME)); }
async function generateSuggestionId(): Promise<string> { for (let attempt = 0; attempt < 30; attempt += 1) { const id = String(randomInt(10000000, 100000000)); if (inMemorySuggestions.has(id)) continue; if (!isDatabaseAvailable() || !await Suggestion.exists({ suggestionId: id }).catch(() => false)) return id; } throw new Error('Could not allocate a suggestion ID.'); }
async function editSuggestionMessage(client: ButtonInteraction['client'] | ChatInputCommandInteraction['client'], record: SuggestionRecord): Promise<boolean> { if (!record.channelId || !record.messageId) return false; const channel = await client.channels.fetch(record.channelId).catch(() => null); if (!channel?.isTextBased() || !('messages' in channel)) return false; const message = await channel.messages.fetch(record.messageId).catch(() => null); if (!message) return false; const attachments = message.attachments ? [...message.attachments.values()] : []; await message.edit({ components: [suggestionPanel(record)], attachments, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }); return true; }
async function executeSuggestions(interaction: ChatInputCommandInteraction): Promise<void> { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); if (!interaction.guildId) { await interaction.editReply('Suggestions can only be submitted inside the server.'); return; } const content = interaction.options.getString('suggestion', true).trim(); if (content.length < 5) { await interaction.editReply('Please make your suggestion a little more detailed.'); return; } const channel = await interaction.client.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null); if (!channel?.isSendable()) { await interaction.editReply(`I cannot access the suggestion channel <#${SUGGESTION_CHANNEL_ID}>.`); return; } const suggestionId = await generateSuggestionId(); let record: SuggestionRecord; try { record = await createSuggestion({ suggestionId, guildId: interaction.guildId, userId: interaction.user.id, discordUsername: interaction.user.username, content, status: 'Pending', upvotes: [], downvotes: [], channelId: SUGGESTION_CHANNEL_ID, messageId: '', createdAt: new Date(), updatedAt: new Date() }); const message = await channel.send({ components: [suggestionPanel(record)], files: artwork(), flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }); record = await saveSuggestionMessageId(record, message.id); } catch (error) { await removeSuggestion(suggestionId); logger.warn(`[Suggestions] Could not create ${suggestionId}: ${error instanceof Error ? error.message : 'Unknown error'}`); await interaction.editReply('I could not post your suggestion. Please try again.'); return; } await interaction.editReply(`✅ Suggestion **${record.suggestionId}** was submitted in <#${SUGGESTION_CHANNEL_ID}>.`); }
export async function handleSuggestionButton(interaction: ButtonInteraction): Promise<boolean> { const match = interaction.customId.match(/^suggestion:vote:(up|down):(\d{8})$/); if (!match) return false; await interaction.deferUpdate(); const direction = match[1] as VoteDirection; const suggestionId = match[2]; const record = await findSuggestion(suggestionId, interaction.guildId) || (interaction.guildId ? recoverSuggestionFromMessage(interaction.message, interaction.guildId) : null); if (!record) { await interaction.followUp({ content: 'That suggestion could not be recovered. Please ask staff to check the suggestion channel.', flags: MessageFlags.Ephemeral }); return true; } if (!votingOpen(record.status)) { await interaction.followUp({ content: `Voting is closed because this suggestion is ${record.status.toLowerCase()}.`, flags: MessageFlags.Ephemeral }); return true; } const userId = interaction.user.id; const up = new Set(record.upvotes); const down = new Set(record.downvotes); let action: string; if (direction === 'up') { if (up.has(userId)) { up.delete(userId); action = 'Your upvote was removed.'; } else { up.add(userId); down.delete(userId); action = 'Your upvote was recorded.'; } } else if (down.has(userId)) { down.delete(userId); action = 'Your downvote was removed.'; } else { down.add(userId); up.delete(userId); action = 'Your downvote was recorded.'; } const updated = await saveSuggestionVotes(record, [...up], [...down]); if (!updated) { await interaction.followUp({ content: 'The suggestion changed while you were voting. Please try again.', flags: MessageFlags.Ephemeral }); return true; } const attachments = interaction.message.attachments ? [...interaction.message.attachments.values()] : []; await interaction.message.edit({ components: [suggestionPanel(updated)], attachments, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => undefined); await interaction.followUp({ content: `✅ ${action} 👍 ${updated.upvotes.length} • 👎 ${updated.downvotes.length}`, flags: MessageFlags.Ephemeral }); return true; }
async function executeDecision(interaction: ChatInputCommandInteraction, status: Exclude<SuggestionStatus, 'Pending'>): Promise<void> { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const canDecide = Boolean(interaction.guild && (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages))); if (!canDecide) { await interaction.editReply('Only the server owner or staff with Manage Server or Manage Messages can make an official suggestion decision.'); return; } const suggestionId = interaction.options.getString('suggestion-id', true).replace(/[^0-9]/g, ''); let existing = await findSuggestion(suggestionId, interaction.guildId); if (!existing && interaction.guildId) existing = await recoverSuggestionFromChannel(interaction.client, suggestionId, interaction.guildId); if (!existing) { await interaction.editReply(`I could not find suggestion \`${suggestionId || 'unknown'}\` in this server.`); return; } const record = await saveSuggestionDecision(suggestionId, interaction.guildId, status, interaction.user.id); if (!record) { await interaction.editReply(`I could not update suggestion \`${suggestionId || 'unknown'}\`. Please try again.`); return; } const messageUpdated = await editSuggestionMessage(interaction.client, record).catch(() => false); const dmText = status === 'Approved' ? `✅ Your suggestion **${record.suggestionId}** has been approved and will take place.` : status === 'Denied' ? `❌ Your suggestion **${record.suggestionId}** has been denied and will not happen.` : `🟡 Your suggestion **${record.suggestionId}** may take place. You will be told if there are any updates.`; const user = await interaction.client.users.fetch(record.userId).catch(() => null); const dmSent = user ? await user.send({ content: dmText }).then(() => true).catch(() => false) : false; await interaction.editReply(`${status === 'Approved' ? '✅' : status === 'Denied' ? '❌' : '🟡'} Suggestion **${record.suggestionId}** is now **${status}**.${messageUpdated ? '' : ' The original suggestion message could not be edited.'}${dmSent ? ' The submitter was notified by DM.' : ' I could not DM the submitter.'}`); }
function decisionCommand(name: 'suggestion-approved' | 'suggestion-denied' | 'suggestion-maybe', status: Exclude<SuggestionStatus, 'Pending'>, description: string) { return { data: new SlashCommandBuilder().setName(name).setDescription(description).addStringOption(option => option.setName('suggestion-id').setDescription('The 8-digit suggestion ID').setRequired(true)), execute: (interaction: ChatInputCommandInteraction) => executeDecision(interaction, status) }; }
export const suggestionCommands = [
    { data: new SlashCommandBuilder().setName('suggest').setDescription('Submit a suggestion').addStringOption(option => option.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(1800)), execute: executeSuggestions },
    { data: new SlashCommandBuilder().setName('suggestions').setDescription('Submit a suggestion').addStringOption(option => option.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(1800)), execute: executeSuggestions },
    decisionCommand('suggestion-approved', 'Approved', 'Approve a suggestion'),
    decisionCommand('suggestion-denied', 'Denied', 'Deny a suggestion'),
    decisionCommand('suggestion-maybe', 'Maybe', 'Mark a suggestion as maybe'),
];
