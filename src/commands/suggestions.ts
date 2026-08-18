import { randomInt } from 'node:crypto';
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
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { Suggestion, type SuggestionRecord, type SuggestionStatus } from '../database/suggestionModel';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const SUGGESTION_CHANNEL_ID = '1538693259621044264';
const PANEL_COLOR = 0x247bf1;
const inMemorySuggestions = new Map<string, SuggestionRecord>();

type VoteDirection = 'up' | 'down';

function underbannerAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.webp' });
}

function underbannerGallery(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(BOTTOM_UNDERBANNER),
    );
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function statusLabel(status: SuggestionStatus): string {
    if (status === 'Approved') return '✅ Approved';
    if (status === 'Denied') return '❌ Denied';
    if (status === 'Maybe') return '🟡 Maybe / Under Consideration';
    return '🕒 Pending Review';
}

function statusColor(status: SuggestionStatus): number {
    if (status === 'Approved') return 0x22c55e;
    if (status === 'Denied') return 0xef4444;
    if (status === 'Maybe') return 0xf59e0b;
    return PANEL_COLOR;
}

function votingOpen(status: SuggestionStatus): boolean {
    return status === 'Pending' || status === 'Maybe';
}

function cacheSuggestion(record: SuggestionRecord): SuggestionRecord {
    const cached: SuggestionRecord = {
        ...record,
        upvotes: [...record.upvotes],
        downvotes: [...record.downvotes],
    };
    inMemorySuggestions.set(cached.suggestionId, cached);
    return cached;
}

async function findSuggestion(suggestionId: string, guildId?: string | null): Promise<SuggestionRecord | null> {
    if (isDatabaseAvailable()) {
        const query: { suggestionId: string; guildId?: string } = { suggestionId };
        if (guildId) query.guildId = guildId;
        const stored = await Suggestion.findOne(query).lean().exec().catch(() => null);
        if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord);
    }

    const cached = inMemorySuggestions.get(suggestionId) || null;
    return cached && (!guildId || cached.guildId === guildId) ? cached : null;
}

async function createSuggestion(record: SuggestionRecord): Promise<SuggestionRecord> {
    if (isDatabaseAvailable()) {
        try {
            const document = await Suggestion.create(record);
            return cacheSuggestion(document.toObject() as SuggestionRecord);
        } catch (error) {
            logger.warn(`[Suggestions] MongoDB create failed for ${record.suggestionId}; using the in-memory fallback: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return cacheSuggestion(record);
}

async function saveSuggestionMessageId(record: SuggestionRecord, messageId: string): Promise<SuggestionRecord> {
    const updated = cacheSuggestion({ ...record, messageId, updatedAt: new Date() });
    if (!isDatabaseAvailable()) return updated;

    const stored = await Suggestion.findOneAndUpdate(
        { suggestionId: record.suggestionId },
        { $set: { messageId, updatedAt: updated.updatedAt } },
        { new: true },
    ).lean().exec().catch(() => null);
    return stored ? cacheSuggestion(stored as unknown as SuggestionRecord) : updated;
}

async function removeSuggestion(suggestionId: string): Promise<void> {
    inMemorySuggestions.delete(suggestionId);
    if (isDatabaseAvailable()) {
        await Suggestion.deleteOne({ suggestionId }).exec().catch(() => undefined);
    }
}

async function saveSuggestionVotes(
    record: SuggestionRecord,
    upvotes: string[],
    downvotes: string[],
): Promise<SuggestionRecord | null> {
    if (!votingOpen(record.status)) return null;
    const updatedAt = new Date();

    if (isDatabaseAvailable()) {
        const stored = await Suggestion.findOneAndUpdate(
            { suggestionId: record.suggestionId, status: { $in: ['Pending', 'Maybe'] } },
            { $set: { upvotes, downvotes, updatedAt } },
            { new: true },
        ).lean().exec().catch(() => null);
        if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord);
    }

    const current = inMemorySuggestions.get(record.suggestionId);
    if (!current || !votingOpen(current.status)) return null;
    return cacheSuggestion({ ...current, upvotes, downvotes, updatedAt });
}

async function saveSuggestionDecision(
    suggestionId: string,
    guildId: string | null,
    status: Exclude<SuggestionStatus, 'Pending'>,
    decidedById: string,
): Promise<SuggestionRecord | null> {
    const decidedAt = new Date();
    if (isDatabaseAvailable()) {
        const stored = await Suggestion.findOneAndUpdate(
            { suggestionId, guildId },
            { $set: { status, decidedAt, decidedById, updatedAt: decidedAt } },
            { new: true },
        ).lean().exec().catch(() => null);
        if (stored) return cacheSuggestion(stored as unknown as SuggestionRecord);
    }

    const current = inMemorySuggestions.get(suggestionId);
    if (!current || current.guildId !== guildId) return null;
    return cacheSuggestion({ ...current, status, decidedAt, decidedById, updatedAt: decidedAt });
}

function voteRow(record: SuggestionRecord): ActionRowBuilder<ButtonBuilder> {
    const disabled = !votingOpen(record.status);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`suggestion:vote:up:${record.suggestionId}`)
            .setLabel(`Upvote • ${record.upvotes.length}`)
            .setEmoji('👍')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`suggestion:vote:down:${record.suggestionId}`)
            .setLabel(`Downvote • ${record.downvotes.length}`)
            .setEmoji('👎')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
    );
}

function suggestionPanel(record: SuggestionRecord): ContainerBuilder {
    const created = Math.floor(new Date(record.createdAt).getTime() / 1000);
    const voteTotal = record.upvotes.length + record.downvotes.length;
    const score = record.upvotes.length - record.downvotes.length;
    const safeSuggestion = record.content.replace(/```/g, "'''").slice(0, 1_800);

    const panel = new ContainerBuilder()
        .setAccentColor(statusColor(record.status))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 💡 Community Suggestion',
            `**Suggestion ID:** \`${record.suggestionId}\``,
            `**Submitted By:** <@${record.userId}> • \`${record.discordUsername}\``,
            `**Status:** ${statusLabel(record.status)}`,
            `**Submitted:** <t:${created}:F> • <t:${created}:R>`,
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '**Suggestion**',
            `\`\`\`\n${safeSuggestion}\n\`\`\``,
            `**Community Votes:** 👍 ${record.upvotes.length} • 👎 ${record.downvotes.length} • **Score:** ${score >= 0 ? '+' : ''}${score} • **Total:** ${voteTotal}`,
        ].join('\n')))
        .addActionRowComponents(voteRow(record))
        .addSeparatorComponents(divider());

    if (record.decidedAt && record.decidedById) {
        const decided = Math.floor(new Date(record.decidedAt).getTime() / 1000);
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Owner Decision:** ${statusLabel(record.status)}\n**Updated By:** <@${record.decidedById}> • <t:${decided}:R>`,
        ));
    }

    return panel.addMediaGalleryComponents(underbannerGallery());
}

async function generateSuggestionId(): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const id = String(randomInt(10_000_000, 100_000_000));
        if (inMemorySuggestions.has(id)) continue;
        if (!isDatabaseAvailable() || !await Suggestion.exists({ suggestionId: id }).catch(() => false)) return id;
    }
    throw new Error('Could not allocate a suggestion ID.');
}

async function editSuggestionMessage(client: ButtonInteraction['client'] | ChatInputCommandInteraction['client'], record: SuggestionRecord): Promise<boolean> {
    if (!record.channelId || !record.messageId) return false;
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return false;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return false;
    await message.edit({
        components: [suggestionPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    return true;
}

async function executeSuggestions(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
        await interaction.editReply('Suggestions can only be submitted inside the server.');
        return;
    }

    const content = interaction.options.getString('suggestion', true).trim();
    if (content.length < 5) {
        await interaction.editReply('Please make your suggestion a little more detailed.');
        return;
    }

    const channel = await interaction.client.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        await interaction.editReply(`I cannot access the suggestion channel <#${SUGGESTION_CHANNEL_ID}>.`);
        return;
    }

    const suggestionId = await generateSuggestionId();
    let record: SuggestionRecord;
    try {
        record = await createSuggestion({
            suggestionId,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            discordUsername: interaction.user.username,
            content,
            status: 'Pending',
            upvotes: [],
            downvotes: [],
            channelId: SUGGESTION_CHANNEL_ID,
            messageId: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const message = await channel.send({
            components: [suggestionPanel(record)],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        record = await saveSuggestionMessageId(record, message.id);
    } catch (error) {
        await removeSuggestion(suggestionId);
        logger.warn(`[Suggestions] Could not create ${suggestionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await interaction.editReply('I could not post your suggestion. Please try again.');
        return;
    }

    await interaction.editReply(`✅ Suggestion **${record.suggestionId}** was submitted in <#${SUGGESTION_CHANNEL_ID}>.`);
}

export async function handleSuggestionButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^suggestion:vote:(up|down):(\d{8})$/);
    if (!match) return false;
    await interaction.deferUpdate();

    const direction = match[1] as VoteDirection;
    const suggestionId = match[2];
    const record = await findSuggestion(suggestionId, interaction.guildId);
    if (!record) {
        await interaction.followUp({ content: 'That suggestion no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!votingOpen(record.status)) {
        await interaction.followUp({ content: `Voting is closed because this suggestion is ${record.status.toLowerCase()}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = interaction.user.id;
    const up = new Set(record.upvotes);
    const down = new Set(record.downvotes);
    let action: string;

    if (direction === 'up') {
        if (up.has(userId)) {
            up.delete(userId);
            action = 'Your upvote was removed.';
        } else {
            up.add(userId);
            down.delete(userId);
            action = 'Your upvote was recorded.';
        }
    } else if (down.has(userId)) {
        down.delete(userId);
        action = 'Your downvote was removed.';
    } else {
        down.add(userId);
        up.delete(userId);
        action = 'Your downvote was recorded.';
    }

    const updated = await saveSuggestionVotes(record, [...up], [...down]);
    if (!updated) {
        await interaction.followUp({ content: 'The suggestion changed while you were voting. Please try again.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.message.edit({
        components: [suggestionPanel(updated)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
    await interaction.followUp({ content: `✅ ${action} 👍 ${updated.upvotes.length} • 👎 ${updated.downvotes.length}`, flags: MessageFlags.Ephemeral });
    return true;
}

async function executeDecision(interaction: ChatInputCommandInteraction, status: Exclude<SuggestionStatus, 'Pending'>): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || interaction.guild.ownerId !== interaction.user.id) {
        await interaction.editReply('Only the Discord server owner can make an official suggestion decision.');
        return;
    }

    const suggestionId = interaction.options.getString('suggestion-id', true).replace(/[^0-9]/g, '');
    const record = await saveSuggestionDecision(
        suggestionId,
        interaction.guildId,
        status,
        interaction.user.id,
    );
    if (!record) {
        await interaction.editReply(`I could not find suggestion \`${suggestionId || 'unknown'}\` in this server.`);
        return;
    }
    await editSuggestionMessage(interaction.client, record).catch(() => false);

    const dmText = status === 'Approved'
        ? `✅ Your suggestion **${record.suggestionId}** has been approved and will take place.`
        : status === 'Denied'
            ? `❌ Your suggestion **${record.suggestionId}** has been denied and will not happen.`
            : `🟡 Your suggestion **${record.suggestionId}** may take place. You will be told if there are any updates.`;
    const user = await interaction.client.users.fetch(record.userId).catch(() => null);
    const dmSent = user ? await user.send({ content: dmText }).then(() => true).catch(() => false) : false;

    await interaction.editReply(
        `${status === 'Approved' ? '✅' : status === 'Denied' ? '❌' : '🟡'} Suggestion **${record.suggestionId}** is now **${status}**.${dmSent ? ' The submitter was notified by DM.' : ' I could not DM the submitter.'}`,
    );
}

function decisionCommand(name: 'suggestion-approved' | 'suggestion-denied' | 'suggestion-maybe', status: Exclude<SuggestionStatus, 'Pending'>, description: string) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
            .setDMPermission(false)
            .addStringOption(option => option
                .setName('suggestion-id')
                .setDescription('The 8-digit suggestion ID')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(20)),
        execute: (interaction: ChatInputCommandInteraction) => executeDecision(interaction, status),
    };
}

export const suggestionCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('suggestions')
            .setDescription('Submit a suggestion for the server community to vote on')
            .setDMPermission(false)
            .addStringOption(option => option
                .setName('suggestion')
                .setDescription('Write your suggestion')
                .setRequired(true)
                .setMinLength(5)
                .setMaxLength(1_500)),
        execute: executeSuggestions,
    },
    decisionCommand('suggestion-approved', 'Approved', 'Owner: approve a community suggestion'),
    decisionCommand('suggestion-denied', 'Denied', 'Owner: deny a community suggestion'),
    decisionCommand('suggestion-maybe', 'Maybe', 'Owner: mark a suggestion as maybe / under consideration'),
];
