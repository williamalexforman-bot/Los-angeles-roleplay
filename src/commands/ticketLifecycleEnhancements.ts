import { resolve } from 'path';
import mongoose from 'mongoose';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type GuildMember,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';
import { isDatabaseAvailable } from '../database/connection';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.webp';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const TICKET_LOG_CHANNEL_ID = '1526255112149008524';
const TICKET_TRANSCRIPT_CHANNEL_ID = '1526255184303493291';
const TICKET_FEEDBACK_CHANNEL_ID = '1539643545416245329';

const TICKET_CATEGORIES = {
    general: 'General Support',
    internal: 'Internal Affairs Support',
    management: 'Management Support',
    highrank: 'High-Rank Support',
} as const;

type TicketType = keyof typeof TICKET_CATEGORIES;

type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

type TicketModule = {
    handleTicketButton(interaction: ButtonInteraction): Promise<boolean>;
    handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean>;
    ticketCommands: Array<{
        data: { name: string };
        execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
    }>;
};

type FeedbackContextRecord = {
    closureId: string;
    guildId: string;
    ticketName: string;
    ticketType: TicketType;
    ownerId: string;
    closedById: string;
    claimedById?: string;
    openedReason: string;
    closeReason: string;
    recap: string;
    createdAt: Date;
    feedbackSubmittedAt?: Date;
};

const feedbackMemory = new Map<string, FeedbackContextRecord>();

const FeedbackContextSchema = new mongoose.Schema<FeedbackContextRecord>({
    closureId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    ticketName: { type: String, required: true },
    ticketType: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    closedById: { type: String, required: true },
    claimedById: { type: String, required: false },
    openedReason: { type: String, required: true },
    closeReason: { type: String, required: true },
    recap: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    feedbackSubmittedAt: { type: Date, required: false },
}, { collection: 'ticket_feedback_contexts' });

const TicketFeedbackContext = (mongoose.models.TicketFeedbackContext
    || mongoose.model<FeedbackContextRecord>('TicketFeedbackContext', FeedbackContextSchema));

function compact(value: string, max = 1_500): string {
    const clean = value.replace(/```/g, "'''").replace(/\s+/g, ' ').trim() || 'Not provided.';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
        return parsed.ownerId && parsed.type in TICKET_CATEGORIES ? parsed : null;
    } catch {
        return null;
    }
}

function componentText(message: Message): string {
    const output: string[] = [];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.content === 'string') output.push(record.content);
        const children = record.components;
        if (Array.isArray(children)) children.forEach(visit);
        const items = record.items;
        if (Array.isArray(items)) items.forEach(visit);
    };
    for (const component of message.components) visit(component.toJSON());
    return output.join('\n');
}

async function fetchTicketMessages(channel: TextChannel): Promise<Message[]> {
    const collected = new Map<string, Message>();
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
        const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch?.size) break;
        for (const message of batch.values()) collected.set(message.id, message);
        const oldest = batch.last();
        if (!oldest || batch.size < 100) break;
        before = oldest.id;
    }
    return Array.from(collected.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function inferOpenedReason(messages: readonly Message[]): string {
    for (const message of messages) {
        const text = componentText(message);
        if (!text) continue;
        const patterns = [
            /###\s+Reason for Opening Ticket\s*\n```\s*([\s\S]*?)\s*```/i,
            /###\s+Reason for Report\s*\n```\s*([\s\S]*?)\s*```/i,
            /\*\*Reason for Opening Ticket:\*\*\s*([^\n]+)/i,
            /\*\*Reason for Report:\*\*\s*([^\n]+)/i,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[1]) return compact(match[1], 1_000);
        }
    }

    const firstHuman = messages.find(message => !message.author.bot && message.cleanContent.trim());
    return firstHuman ? compact(firstHuman.cleanContent, 1_000) : 'No opening reason could be recovered.';
}

function transcriptText(messages: readonly Message[]): string {
    if (!messages.length) return 'Transcript could not be fetched.';
    return messages.map(message => {
        const attachments = Array.from(message.attachments.values()).map(file => file.url).join(' ');
        const components = componentText(message).replace(/\n+/g, ' | ').trim();
        const body = message.cleanContent.trim() || components || '[no text]';
        return `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id}): ${body}${attachments ? ` ${attachments}` : ''}`;
    }).join('\n');
}

function usefulConversation(messages: readonly Message[]): string {
    return messages
        .filter(message => !message.author.bot || message.cleanContent.trim())
        .slice(-80)
        .map(message => `${message.author.bot ? 'BOT' : message.author.username}: ${message.cleanContent || componentText(message)}`)
        .filter(line => !/BOT:\s*$/i.test(line))
        .join('\n')
        .slice(0, 14_000);
}

async function generateAiRecap(messages: readonly Message[], openedReason: string): Promise<string> {
    const fallback = (() => {
        const humanMessages = messages.filter(message => !message.author.bot && message.cleanContent.trim());
        const lastHuman = humanMessages.at(-1)?.cleanContent;
        if (lastHuman && compact(lastHuman, 400).toLowerCase() !== compact(openedReason, 400).toLowerCase()) {
            return `The ticket was opened about ${compact(openedReason, 350)} The conversation concluded with ${compact(lastHuman, 350)}`;
        }
        return `The ticket was opened about ${compact(openedReason, 550)} Support staff reviewed the request and the ticket was then closed.`;
    })();

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return fallback;

    const conversation = usefulConversation(messages);
    if (!conversation.trim()) return fallback;

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.TICKET_RECAP_MODEL?.trim() || 'gpt-5-mini',
                input: [
                    {
                        role: 'system',
                        content: 'Summarize a Discord support ticket in 1-3 concise sentences. State what the user needed, what staff did or explained, and the outcome if clear. Do not invent facts. Do not include private IDs or raw logs.',
                    },
                    {
                        role: 'user',
                        content: `Opening reason: ${openedReason}\n\nTicket conversation:\n${conversation}`,
                    },
                ],
                max_output_tokens: 220,
            }),
            signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) {
            logger.warn(`[Tickets] AI recap request returned HTTP ${response.status}; using fallback recap.`);
            return fallback;
        }
        const payload = await response.json() as { output_text?: unknown };
        const recap = typeof payload.output_text === 'string' ? payload.output_text.trim() : '';
        return recap ? compact(recap, 1_100) : fallback;
    } catch (error) {
        logger.warn(`[Tickets] AI recap unavailable; using fallback recap: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return fallback;
    }
}

function claimedPanel(displayName: string, channelUrl: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🎫 Your case has been claimed',
            `Hi, ${compact(displayName, 80)}. A Support team member has claimed your case and will reply in the ticket channel.`,
        ].join('\n')))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('Go to Case')
                    .setStyle(ButtonStyle.Link)
                    .setURL(channelUrl),
            ),
        )
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function closedPanel(displayName: string, recap: string, closureId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 🎫 Thanks for working with us, ${compact(displayName, 80)}`,
            'Your case is closed. I included a short recap and your transcript below. If you have a moment, your feedback helps us improve Support.',
        ].join('\n')))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket-feedback:start:${closureId}`)
                    .setLabel('Share Feedback')
                    .setStyle(ButtonStyle.Primary),
            ),
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🤖 A quick recap from LARP Assistant',
            recap,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function feedbackLogPanel(context: FeedbackContextRecord, submitterId: string, rating: number, notes: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⭐ Ticket Feedback',
            `> **Submitted By:** <@${submitterId}>`,
            `> **Rating:** **${rating}/10**`,
            `> **Ticket:** \`${compact(context.ticketName, 90)}\``,
            `> **Category:** ${TICKET_CATEGORIES[context.ticketType]}`,
            `> **Claimed By:** ${context.claimedById ? `<@${context.claimedById}>` : 'Unclaimed'}`,
            `> **Closed By:** <@${context.closedById}>`,
            '',
            '### Reason Ticket Was Opened',
            `> ${compact(context.openedReason, 1_000)}`,
            '',
            '### Feedback Notes',
            `> ${compact(notes, 1_500)}`,
            '',
            '### Ticket Recap',
            `> ${compact(context.recap, 1_000)}`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function feedbackModal(closureId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`ticket-feedback:submit:${closureId}`)
        .setTitle('Ticket Feedback')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('rating')
                    .setLabel('Rating from 1 to 10')
                    .setPlaceholder('10')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(2),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('notes')
                    .setLabel('Tell us about your ticket experience')
                    .setPlaceholder('What went well? What could be improved?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1_500),
            ),
        );
}

function memberHasRole(member: ButtonInteraction['member'] | ChatInputCommandInteraction['member'], roleId: string): boolean {
    if (!member) return false;
    const roles = (member as GuildMember).roles;
    if (roles && 'cache' in roles) return roles.cache.has(roleId);
    return Array.isArray((member as { roles?: string[] }).roles)
        && (member as { roles: string[] }).roles.includes(roleId);
}

function isTicketStaff(interaction: ButtonInteraction | ChatInputCommandInteraction): boolean {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
        || memberHasRole(interaction.member, TICKET_SUPPORT_ROLE_ID);
}

async function saveFeedbackContext(context: FeedbackContextRecord): Promise<void> {
    feedbackMemory.set(context.closureId, context);
    if (!isDatabaseAvailable()) return;
    await TicketFeedbackContext.updateOne(
        { closureId: context.closureId },
        { $set: context },
        { upsert: true },
    ).exec().catch(error => {
        logger.warn(`[Tickets] Could not persist feedback context ${context.closureId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function loadFeedbackContext(closureId: string): Promise<FeedbackContextRecord | null> {
    const cached = feedbackMemory.get(closureId);
    if (cached) return cached;
    if (!isDatabaseAvailable()) return null;
    const record = await TicketFeedbackContext.findOne({ closureId }).lean().exec().catch(() => null);
    if (!record) return null;
    const normalized = record as unknown as FeedbackContextRecord;
    feedbackMemory.set(closureId, normalized);
    return normalized;
}

async function markFeedbackSubmitted(closureId: string): Promise<void> {
    const context = feedbackMemory.get(closureId);
    if (context) context.feedbackSubmittedAt = new Date();
    if (!isDatabaseAvailable()) return;
    await TicketFeedbackContext.updateOne(
        { closureId },
        { $set: { feedbackSubmittedAt: new Date() } },
    ).exec().catch(() => undefined);
}

async function sendClaimedDm(interaction: ButtonInteraction, metadata: TicketMetadata, channel: TextChannel): Promise<void> {
    const user = await interaction.client.users.fetch(metadata.ownerId).catch(() => null);
    if (!user) return;
    const member = interaction.guild ? await interaction.guild.members.fetch(metadata.ownerId).catch(() => null) : null;
    const displayName = member?.displayName || user.globalName || user.username;
    const url = `https://discord.com/channels/${channel.guildId}/${channel.id}`;
    await user.send({
        components: [claimedPanel(displayName, url)],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(error => logger.warn(`[Tickets] Could not send claim DM to ${metadata.ownerId}: ${error instanceof Error ? error.message : 'Unknown error'}`));
}

async function writeLegacyCloseLogs(
    interaction: ButtonInteraction | ChatInputCommandInteraction,
    channel: TextChannel,
    metadata: TicketMetadata,
    closeReason: string,
    transcript: Buffer,
): Promise<void> {
    const transcriptName = `${channel.name}-transcript.txt`;
    const transcriptChannel = await interaction.client.channels.fetch(TICKET_TRANSCRIPT_CHANNEL_ID).catch(() => null);
    if (transcriptChannel?.isSendable()) {
        await transcriptChannel.send({
            content: `Transcript for **${channel.name}** • Opened by <@${metadata.ownerId}> • Closed by <@${interaction.user.id}>`,
            files: [new AttachmentBuilder(transcript, { name: transcriptName })],
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }

    const logChannel = await interaction.client.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
    if (logChannel?.isSendable()) {
        await logChannel.send({
            content: [
                `**Ticket Closed:** \`${channel.name}\``,
                `**Opened By:** <@${metadata.ownerId}>`,
                `**Closed By:** <@${interaction.user.id}>`,
                `**Category:** ${TICKET_CATEGORIES[metadata.type]}`,
                `**Claimed By:** ${metadata.claimedBy ? `<@${metadata.claimedBy}>` : 'Unclaimed'}`,
                `**Reason:** ${compact(closeReason, 1_000)}`,
            ].join('\n'),
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    }
}

async function enhancedCloseTicket(
    interaction: ButtonInteraction | ChatInputCommandInteraction,
    closeReason: string,
): Promise<void> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply('This command can only be used inside a ticket channel.');
        return;
    }

    const metadata = decodeMetadata(channel.topic);
    if (!metadata) {
        await interaction.editReply('This is not a managed ticket channel.');
        return;
    }

    if (interaction.user.id !== metadata.ownerId && !isTicketStaff(interaction)) {
        await interaction.editReply('Only the ticket opener or support staff can close this ticket.');
        return;
    }

    const messages = await fetchTicketMessages(channel);
    const openedReason = inferOpenedReason(messages);
    const transcriptString = transcriptText(messages);
    const transcript = Buffer.from(transcriptString, 'utf8');
    const recap = await generateAiRecap(messages, openedReason);
    const closureId = `${channel.id.slice(-8)}${Date.now().toString(36)}`.slice(0, 30);

    const context: FeedbackContextRecord = {
        closureId,
        guildId: channel.guildId,
        ticketName: channel.name,
        ticketType: metadata.type,
        ownerId: metadata.ownerId,
        closedById: interaction.user.id,
        claimedById: metadata.claimedBy,
        openedReason,
        closeReason,
        recap,
        createdAt: new Date(),
    };
    await saveFeedbackContext(context);
    await writeLegacyCloseLogs(interaction, channel, metadata, closeReason, transcript);

    const owner = await interaction.client.users.fetch(metadata.ownerId).catch(() => null);
    if (owner) {
        const member = interaction.guild ? await interaction.guild.members.fetch(metadata.ownerId).catch(() => null) : null;
        const displayName = member?.displayName || owner.globalName || owner.username;
        await owner.send({
            components: [closedPanel(displayName, recap, closureId)],
            files: [
                ...artwork(),
                new AttachmentBuilder(transcript, { name: `${channel.name}-transcript.txt` }),
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(error => logger.warn(`[Tickets] Could not send close DM to ${metadata.ownerId}: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }

    await interaction.editReply('🔒 Ticket closed. The user was sent the V2 closure recap, feedback button, and transcript.');
    await channel.delete(`Ticket closed by ${interaction.user.tag}: ${closeReason}`).catch(error => {
        logger.error(`[Tickets] Could not delete ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function handleFeedbackButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^ticket-feedback:start:([A-Za-z0-9_-]+)$/u);
    if (!match) return false;
    const context = await loadFeedbackContext(match[1]);
    if (!context) {
        await interaction.reply({ content: 'This feedback request could not be loaded. Please contact Support.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.user.id !== context.ownerId) {
        await interaction.reply({ content: 'Only the member who opened this ticket can submit its feedback.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (context.feedbackSubmittedAt) {
        await interaction.reply({ content: 'Feedback has already been submitted for this ticket.', flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.showModal(feedbackModal(context.closureId));
    return true;
}

async function handleFeedbackModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^ticket-feedback:submit:([A-Za-z0-9_-]+)$/u);
    if (!match) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const context = await loadFeedbackContext(match[1]);
    if (!context) {
        await interaction.editReply('This feedback request could not be loaded. Please contact Support.');
        return true;
    }
    if (interaction.user.id !== context.ownerId) {
        await interaction.editReply('Only the member who opened this ticket can submit its feedback.');
        return true;
    }
    if (context.feedbackSubmittedAt) {
        await interaction.editReply('Feedback has already been submitted for this ticket.');
        return true;
    }

    const ratingRaw = interaction.fields.getTextInputValue('rating').trim();
    const rating = Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
        await interaction.editReply('Your rating must be a whole number from **1 to 10**. Please press Share Feedback and try again.');
        return true;
    }
    const notes = interaction.fields.getTextInputValue('notes').trim();
    if (!notes) {
        await interaction.editReply('Please include a short note about your ticket experience.');
        return true;
    }

    const feedbackChannel = await interaction.client.channels.fetch(TICKET_FEEDBACK_CHANNEL_ID).catch(() => null);
    if (!feedbackChannel?.isSendable()) {
        await interaction.editReply('The feedback channel is unavailable right now. Please try again later.');
        return true;
    }

    await feedbackChannel.send({
        components: [feedbackLogPanel(context, interaction.user.id, rating, notes)],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    await markFeedbackSubmitted(context.closureId);
    await interaction.editReply(`⭐ Thanks! Your **${rating}/10** ticket feedback was submitted.`);
    return true;
}

export function installTicketLifecycleEnhancements(ticketModule: TicketModule): void {
    const originalButton = ticketModule.handleTicketButton.bind(ticketModule);
    const originalModal = ticketModule.handleTicketModal.bind(ticketModule);

    ticketModule.handleTicketButton = async (interaction: ButtonInteraction): Promise<boolean> => {
        if (interaction.customId.startsWith('ticket-feedback:')) return handleFeedbackButton(interaction);

        if (interaction.customId === 'ticket:claim') {
            const channel = interaction.channel;
            const metadata = channel?.type === ChannelType.GuildText ? decodeMetadata(channel.topic) : null;
            const wasClaimed = Boolean(metadata?.claimedBy);
            const handled = await originalButton(interaction);
            if (handled && metadata && !wasClaimed && channel?.type === ChannelType.GuildText) {
                const updated = decodeMetadata(channel.topic);
                if (updated?.claimedBy === interaction.user.id) await sendClaimedDm(interaction, updated, channel);
            }
            return handled;
        }

        if (interaction.customId === 'ticket:close' || interaction.customId === 'ticket:close-confirm') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await enhancedCloseTicket(
                interaction,
                interaction.customId === 'ticket:close-confirm' ? 'Close request accepted.' : 'Closed from the ticket panel.',
            );
            return true;
        }

        return originalButton(interaction);
    };

    ticketModule.handleTicketModal = async (interaction: ModalSubmitInteraction): Promise<boolean> => {
        if (interaction.customId.startsWith('ticket-feedback:')) return handleFeedbackModal(interaction);
        return originalModal(interaction);
    };

    const closeCommand = ticketModule.ticketCommands.find(command => command.data.name === 'close');
    if (closeCommand) {
        closeCommand.execute = async (interaction: ChatInputCommandInteraction): Promise<void> => {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await enhancedCloseTicket(interaction, 'Closed with /close.');
        };
    }

    logger.info('[Tickets] Enhanced claimed/closed V2 DMs, AI recap, transcript, and feedback flow installed.');
}
