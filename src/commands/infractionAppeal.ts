import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { Infraction, InfractionAppeal } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { createLogoAttachment } from '../utils/embeds';
import { getInfractionByThreadIdPublic, recoverInfractionByThreadId, type InfractionRecord } from '../commands/staffManagement';
import { logger } from '../utils/logger';

const INFRACTION_APPEAL_CHANNEL_ID = process.env.INFRACTION_APPEAL_CHANNEL_ID || '1537227443423682612';

let cachedClient: Client | null = null;

export function setInfractionAppealClient(client: Client): void {
    cachedClient = client;
}

function generateAppealId(): string {
    return `IA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

export function infractionAppealButton(threadId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`infraction-appeal:start:${threadId}`)
            .setLabel('Appeal Infraction')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚖️'),
    );
}

function reviewButtons(appealId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`infraction-appeal:approve:${appealId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`infraction-appeal:deny:${appealId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
}

function appealFormModal(threadId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction-appeal:form:${threadId}`)
        .setTitle('Infraction Appeal Form')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('discord-username')
                    .setLabel('1. Discord Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('roblox-username')
                    .setLabel('2. Roblox Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('appeal-reason')
                    .setLabel('3. Why should we appeal your infraction? (2+ sentences)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('will-repeat')
                    .setLabel('4. Will you do this again? (YES or NO)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(10),
            ),
        );
}

function reviewReasonModal(appealId: string, action: 'approve' | 'deny'): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction-appeal:${action}-modal:${appealId}`)
        .setTitle(action === 'approve' ? 'Approve Infraction Appeal' : 'Deny Infraction Appeal')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('review-reason')
                    .setLabel(action === 'approve' ? 'Reason for approval' : 'Reason for denial')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
        );
}

/**
 * Routes infraction-appeal button interactions. Returns false for unrelated buttons.
 */
export async function handleInfractionAppealButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, threadId] = interaction.customId.split(':');

    if (action === 'start' && threadId) {
        // Look up the infraction record to check if it's appealable
        let record = await getInfractionByThreadIdPublic(threadId).catch(() => null);

        // Fallback: recover from the Discord thread if the record isn't in memory or DB
        if (!record) {
            record = await recoverInfractionByThreadId(interaction.client, threadId, interaction.guildId || undefined).catch(() => null);
        }

        // Fallback: look up punishment records from the database (threadId is "punishment-PUN-XXXX")
        if (!record && isDatabaseAvailable()) {
            try {
                const dbRecord = await Infraction.findOne({ threadId }).lean().exec() as unknown as {
                    appealable?: boolean;
                    action?: string;
                    reason?: string;
                    caseNumber?: string;
                    memberId?: string;
                    memberUsername?: string;
                    issuedById?: string;
                    status?: string;
                    createdAt?: Date;
                } | null;
                if (dbRecord) {
                    record = {
                        caseNumber: dbRecord.caseNumber || threadId,
                        guildId: interaction.guildId || '',
                        memberId: dbRecord.memberId || '',
                        memberUsername: dbRecord.memberUsername || '',
                        issuedById: dbRecord.issuedById || '',
                        action: (dbRecord.action || 'Infraction') as InfractionRecord['action'],
                        reason: dbRecord.reason || 'No reason provided.',
                        ruleBroken: dbRecord.reason || 'No rule supplied.',
                        evidence: 'No evidence supplied.',
                        internalNotes: 'No internal notes supplied.',
                        notifyMember: true,
                        appealable: dbRecord.appealable === undefined ? true : dbRecord.appealable,
                        expiration: 'No expiration set.',
                        status: (dbRecord.status || 'Active') as InfractionRecord['status'],
                        parentChannelId: '',
                        headerMessageId: '',
                        threadId,
                        detailMessageId: '',
                        createdAt: dbRecord.createdAt?.toISOString() || new Date().toISOString(),
                        updatedAt: dbRecord.createdAt?.toISOString() || new Date().toISOString(),
                        history: [],
                    };
                }
            } catch {
                // ignore
            }
        }

        if (!record) {
            await interaction.reply({ content: 'This infraction record could not be loaded.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!record.appealable) {
            await interaction.reply({ content: 'This infraction is not marked as appealable. Only appealable infractions can be appealed.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(appealFormModal(threadId));
        return true;
    }

    if ((action === 'approve' || action === 'deny') && threadId) {
        await interaction.showModal(reviewReasonModal(threadId, action));
        return true;
    }

    return false;
}

/**
 * Routes infraction-appeal modal submissions. Returns false for unrelated modals.
 */
export async function handleInfractionAppealModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction-appeal:')) return false;

    const [, action, threadId] = interaction.customId.split(':');
    if (!threadId) return false;

    // ── Appeal form submission ──────────────────────────────────────────────
    if (action === 'form') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const discordUsername = interaction.fields.getTextInputValue('discord-username').trim();
        const robloxUsername = interaction.fields.getTextInputValue('roblox-username').trim();
        const appealReason = interaction.fields.getTextInputValue('appeal-reason').trim();
        const willRepeat = interaction.fields.getTextInputValue('will-repeat').trim().toUpperCase();

        // Validate: appeal reason must be 2+ sentences
        const sentenceCount = (appealReason.match(/[.!?]+/g) || []).length;
        if (sentenceCount < 2) {
            await interaction.editReply('Your appeal reason must be **2+ sentences** with details. Please try again.');
            return true;
        }

        // Validate: will-repeat must be YES or NO
        if (willRepeat !== 'YES' && willRepeat !== 'NO') {
            await interaction.editReply('Please answer the "Will you do this again?" question with **YES** or **NO**.');
            return true;
        }

        if (!cachedClient) {
            await interaction.editReply('The appeal system is not ready yet. Please try again later.');
            return true;
        }

        // Look up the infraction record to get the case number and link
        const infraction = await cachedClient.channels.fetch(threadId).catch(() => null);
        const threadUrl = infraction?.isThread() ? infraction.url : `https://discord.com/channels/${interaction.guildId}/${threadId}`;

        const appealId = generateAppealId();
        const embed = brandedEmbed(`⚖️ Infraction Appeal | ${appealId}`)
            .setDescription('A new infraction appeal has been submitted and requires staff review.')
            .addFields(
                { name: 'Appeal ID', value: appealId, inline: true },
                { name: 'Discord User', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Discord Username', value: discordUsername, inline: true },
                { name: 'Roblox Username', value: robloxUsername, inline: true },
                { name: 'Infraction Thread', value: `[Open Thread](${threadUrl})`, inline: true },
                { name: 'Appeal Reason', value: appealReason },
                { name: 'Will Do Again?', value: willRepeat, inline: true },
                { name: 'Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
            );

        const channel = await cachedClient.channels.fetch(INFRACTION_APPEAL_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply('The appeal review channel is unavailable. Please contact staff.');
            return true;
        }

        const reviewMessage = await channel.send({
            embeds: [embed],
            components: reviewButtons(appealId),
            files: [createLogoAttachment()],
            allowedMentions: { parse: [] },
        });

        if (isDatabaseAvailable()) {
            await InfractionAppeal.create({
                appealId,
                guildId: interaction.guildId || '',
                infractionThreadId: threadId,
                infractionCaseNumber: threadId,
                infractionLink: threadUrl,
                userId: interaction.user.id,
                username: interaction.user.username,
                discordUsername,
                robloxUsername,
                appealReason,
                willRepeat,
                status: 'Pending',
                reviewMessageId: reviewMessage.id,
                reviewChannelId: INFRACTION_APPEAL_CHANNEL_ID,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }

        await interaction.editReply(`Your infraction appeal **${appealId}** has been submitted. You will receive a DM with the result.`);
        return true;
    }

    // ── Approve / Deny review submission ────────────────────────────────────
    if ((action === 'approve-modal' || action === 'deny-modal') && threadId) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const reviewReason = interaction.fields.getTextInputValue('review-reason').trim();
        const isApproved = action === 'approve-modal';
        const appealId = threadId;

        const record = await InfractionAppeal.findOne({ appealId }).lean().exec().catch(() => null);
        if (!record) {
            await interaction.editReply('This appeal could not be found.');
            return true;
        }
        if (record.status !== 'Pending') {
            await interaction.editReply(`This appeal has already been ${record.status.toLowerCase()}.`);
            return true;
        }

        await InfractionAppeal.updateOne(
            { appealId },
            {
                $set: {
                    status: isApproved ? 'Approved' : 'Denied',
                    reviewedById: interaction.user.id,
                    reviewReason,
                    updatedAt: new Date(),
                },
            },
        ).exec().catch(() => undefined);

        // ── DM the user with the result + reason ────────────────────────────
        const resultEmbed = brandedEmbed(
            isApproved ? '✅ Infraction Appeal Approved' : '❌ Infraction Appeal Denied',
            isApproved ? 0x22c55e : 0xef4444,
        )
            .setDescription(
                isApproved
                    ? 'Your infraction appeal has been **approved**!'
                    : 'Unfortunately, your infraction appeal has been **denied**.',
            )
            .addFields(
                { name: 'Appeal ID', value: appealId, inline: true },
                { name: 'Reason', value: reviewReason },
                { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
            );

        try {
            const user = await interaction.client.users.fetch(record.userId);
            await user.send({ embeds: [resultEmbed], files: [createLogoAttachment()] });
        } catch (error) {
            logger.warn(`[InfractionAppeal] Could not DM ${record.userId}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        // ── If approved: post "appealed" in the infraction thread ───────────
        if (isApproved) {
            try {
                const thread = await interaction.client.channels.fetch(record.infractionThreadId).catch(() => null);
                if (thread?.isThread() && thread.isSendable()) {
                    const threadEmbed = brandedEmbed('✅ Appeal Approved', 0x22c55e)
                        .setDescription(`This infraction has been **appealed and approved** by <@${interaction.user.id}>.`)
                        .addFields(
                            { name: 'Appeal ID', value: appealId, inline: true },
                            { name: 'Reason', value: reviewReason },
                        );
                    await thread.send({ embeds: [threadEmbed], files: [createLogoAttachment()] });
                }
            } catch (error) {
                logger.warn(`[InfractionAppeal] Could not post approval in thread: ${error instanceof Error ? error.message : 'Unknown'}`);
            }
        }

        // ── Update the review message ───────────────────────────────────────
        try {
            const channel = await interaction.client.channels.fetch(record.reviewChannelId).catch(() => null);
            if (channel?.isSendable()) {
                const reviewMessage = await channel.messages.fetch(record.reviewMessageId).catch(() => null);
                if (reviewMessage) {
                    const updatedEmbed = brandedEmbed(
                        `⚖️ Infraction Appeal | ${appealId}`,
                        isApproved ? 0x22c55e : 0xef4444,
                    )
                        .setDescription(`This infraction appeal has been **${isApproved ? 'approved' : 'denied'}**.`)
                        .addFields(
                            { name: 'Appeal ID', value: appealId, inline: true },
                            { name: 'Discord User', value: `<@${record.userId}>`, inline: true },
                            { name: 'Status', value: isApproved ? '✅ Approved' : '❌ Denied', inline: true },
                            { name: 'Infraction Thread', value: `[Open Thread](${record.infractionLink})`, inline: true },
                            { name: 'Review Reason', value: reviewReason },
                            { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                        );
                    await reviewMessage.edit({ embeds: [updatedEmbed], components: [] });
                }
            }
        } catch (error) {
            logger.warn(`[InfractionAppeal] Could not update review message: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        await interaction.editReply(
            `Appeal **${appealId}** has been ${isApproved ? 'approved' : 'denied'}. The user has been notified by DM.`,
        );
        return true;
    }

    return false;
}