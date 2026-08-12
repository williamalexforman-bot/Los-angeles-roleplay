import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
    type MessageCreateOptions,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { BanAppeal } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { createLogoAttachment } from '../utils/embeds';
import { logger } from '../utils/logger';

const BAN_APPEAL_CHANNEL_ID = process.env.BAN_APPEAL_CHANNEL_ID || '1529286560271306995';
const INVITE_LINK = 'https://discord.gg/wSr8squzmV';
const LARP_EMOJI = '<:Larp:1535409995464835175>';

const APPEAL_QUESTIONS = [
    'Please state your **Roblox username**.',
    'Please state your **Discord username**.',
    'Why were you **banned** from our server?',
    'Please state the reason that you feel we should **unban** you from our server.',
    '**OPTIONAL** — If you feel this was a false ban, please state why it was false, what about it was false, and full details.',
] as const;

const APPEAL_INTRO = `# Los Angeles Roleplay Ban Appeal ${LARP_EMOJI}

Hello 👋🏻 We understand that you have been banned from **Los Angeles Roleplay** we want to give you a chance to appeal this ban and have the opportunity to be able to come back into our server! Please enter the details correctly and fairly and wait for our staff team to respond to it.

Please note the following rules:
> If you are a staff member who was banned the **High Ranking Team** will have a talk about if you deserve to have the same rank.
> If you were a staff member who was banned you will be placed on the Zero Tolerance Policy role.
> Please use 3+ Sentences and describe exactly fair responses do not say **I was falsely banned** or **I didn't raid** share details.

Are you ready to start if so reply with **start**.
-# Los Angeles Roleplay.`;

const APPEAL_COMPLETE = 'Thank you for taking your time to submit this ban appeal. You will get a DM when the results come in.';

interface AppealSession {
    userId: string;
    guildId: string;
    username: string;
    step: number;
    answers: string[];
    lastPromptAt: number;
}

const activeSessions = new Map<string, AppealSession>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function generateAppealId(): string {
    return `APPEAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function pruneSessions(): void {
    const now = Date.now();
    for (const [userId, session] of activeSessions) {
        if (now - session.lastPromptAt > SESSION_TTL_MS) activeSessions.delete(userId);
    }
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

function appealButton(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('ban-appeal:start')
            .setLabel('Appeal Ban')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚖️'),
    );
}

function reviewButtons(appealId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`ban-appeal:approve:${appealId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`ban-appeal:deny:${appealId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
}

function denyReasonModal(appealId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`ban-appeal:deny-modal:${appealId}`)
        .setTitle('Deny Ban Appeal')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('deny-reason')
                    .setLabel('Reason for denial')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
        );
}

/**
 * Sends a DM to a user who was banned or kicked. Bans include an appeal button.
 */
export async function sendPunishmentDm(
    client: Client,
    userId: string,
    kind: 'ban' | 'kick',
    reason: string,
    guildName: string,
): Promise<boolean> {
    try {
        const user = await client.users.fetch(userId);
        if (!user) return false;

        const embed = brandedEmbed(kind === 'ban' ? '🚫 You Have Been Banned' : '👢 You Have Been Kicked')
            .setDescription(
                kind === 'ban'
                    ? `You have been banned from **${guildName}**. If you believe this was a mistake, you may appeal the ban using the button below.`
                    : `You have been kicked from **${guildName}**. You may rejoin at any time.`,
            )
            .addFields(
                { name: 'Reason', value: reason || 'No reason provided.' },
                { name: 'Server', value: guildName, inline: true },
            );

        const options: MessageCreateOptions = {
            embeds: [embed],
            files: [createLogoAttachment()],
        };
        if (kind === 'ban') options.components = [appealButton()];

        try {
            await user.send(options);
        } catch {
            // If the attachment fails (e.g., logo missing on host), retry without it
            // so the ban/kick DM is still delivered.
            const fallbackOptions: MessageCreateOptions = { embeds: [embed] };
            if (kind === 'ban') fallbackOptions.components = [appealButton()];
            await user.send(fallbackOptions);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Handles a DM message during an active appeal session.
 */
export async function handleAppealDmMessage(message: Message): Promise<boolean> {
    if (!message.guild && !message.author.bot) {
        pruneSessions();
        const session = activeSessions.get(message.author.id);
        if (!session) return false;

        const content = message.content.trim().toLowerCase();

        // Starting the appeal
        if (session.step === 0) {
            if (content !== 'start') {
                await message.author.send('Please reply with **start** to begin your ban appeal.');
                return true;
            }
            session.step = 1;
            session.lastPromptAt = Date.now();
            await message.author.send(`**Question 1 of ${APPEAL_QUESTIONS.length}**\n\n${APPEAL_QUESTIONS[0]}`);
            return true;
        }

        // Collecting answers
        const answer = message.content.trim();
        if (!answer) {
            await message.author.send('Please provide a valid answer.');
            return true;
        }

        session.answers.push(answer);
        session.lastPromptAt = Date.now();

        if (session.step < APPEAL_QUESTIONS.length) {
            session.step += 1;
            await message.author.send(`**Question ${session.step} of ${APPEAL_QUESTIONS.length}**\n\n${APPEAL_QUESTIONS[session.step - 1]}`);
            return true;
        }

        // All questions answered — submit the appeal
        await submitAppeal(session);
        activeSessions.delete(message.author.id);
        return true;
    }
    return false;
}

async function submitAppeal(session: AppealSession): Promise<void> {
    try {
        const appealId = generateAppealId();
        const [robloxUsername, discordUsername, banReason, unbanReason, falseBanDetails] = session.answers;
        const falseBan = falseBanDetails?.trim() || 'Not provided.';

        const embed = brandedEmbed(`⚖️ Ban Appeal | ${appealId}`)
            .setDescription('A new ban appeal has been submitted and requires staff review.')
            .addFields(
                { name: 'Appeal ID', value: appealId, inline: true },
                { name: 'Discord User', value: `<@${session.userId}>`, inline: true },
                { name: 'Discord Username', value: discordUsername || 'Not provided.', inline: true },
                { name: 'Roblox Username', value: robloxUsername || 'Not provided.', inline: true },
                { name: 'Why Banned', value: banReason || 'Not provided.' },
                { name: 'Why Unban', value: unbanReason || 'Not provided.' },
                { name: 'False Ban Details', value: falseBan },
                { name: 'Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
            );

        if (!cachedClient) {
            logger.warn('[BanAppeal] Client is not configured; cannot submit appeal.');
            return;
        }

        const channel = await cachedClient.channels.fetch(BAN_APPEAL_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            logger.warn(`[BanAppeal] Review channel ${BAN_APPEAL_CHANNEL_ID} is unavailable.`);
            return;
        }

        const reviewMessage = await channel.send({
            embeds: [embed],
            components: reviewButtons(appealId),
            files: [createLogoAttachment()],
            allowedMentions: { parse: [] },
        });

        if (isDatabaseAvailable()) {
            await BanAppeal.create({
                appealId,
                guildId: session.guildId,
                userId: session.userId,
                username: session.username,
                robloxUsername: robloxUsername || 'Not provided.',
                discordUsername: discordUsername || 'Not provided.',
                banReason: banReason || 'Not provided.',
                unbanReason: unbanReason || 'Not provided.',
                falseBanDetails: falseBan,
                status: 'Pending',
                reviewMessageId: reviewMessage.id,
                reviewChannelId: BAN_APPEAL_CHANNEL_ID,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }

        await cachedClient.users.fetch(session.userId).then(user =>
            user.send({ content: APPEAL_COMPLETE, files: [createLogoAttachment()] }),
        ).catch(() => undefined);
    } catch (error) {
        logger.error(`[BanAppeal] Submission failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
}

// The client is set at startup so the module can send DMs and fetch channels.
let cachedClient: Client | null = null;

export function setBanAppealClient(client: Client): void {
    cachedClient = client;
}

/**
 * Routes ban-appeal button interactions. Returns false for unrelated buttons.
 */
export async function handleBanAppealButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ban-appeal:')) return false;

    const [, action, appealId] = interaction.customId.split(':');

    if (action === 'start') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const session: AppealSession = {
            userId: interaction.user.id,
            guildId: interaction.guildId || '',
            username: interaction.user.username,
            step: 0,
            answers: [],
            lastPromptAt: Date.now(),
        };
        activeSessions.set(interaction.user.id, session);
        await interaction.user.send({ content: APPEAL_INTRO, files: [createLogoAttachment()] }).catch(() => {
            // If the DM fails, tell them in the ephemeral reply.
        });
        await interaction.editReply('The ban appeal process has been started. Check your DMs!');
        return true;
    }

    if (action === 'approve' && appealId) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const record = await BanAppeal.findOne({ appealId }).lean().exec().catch(() => null);
        if (!record) {
            await interaction.editReply('This appeal could not be found.');
            return true;
        }
        if (record.status !== 'Pending') {
            await interaction.editReply(`This appeal has already been ${record.status.toLowerCase()}.`);
            return true;
        }

        await BanAppeal.updateOne(
            { appealId },
            { $set: { status: 'Approved', reviewedById: interaction.user.id, updatedAt: new Date() } },
        ).exec().catch(() => undefined);

        // DM the user: approved + invite link
        const approvedEmbed = brandedEmbed('✅ Ban Appeal Approved')
            .setDescription('Your ban appeal has been **approved**! You may rejoin the server using the invite link below.')
            .addFields(
                { name: 'Invite Link', value: INVITE_LINK },
                { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
            );
        await interaction.client.users.fetch(record.userId).then(user =>
            user.send({ embeds: [approvedEmbed], files: [createLogoAttachment()] }),
        ).then(() =>
            interaction.client.users.fetch(record.userId).then(user =>
                user.send({ content: INVITE_LINK }),
            ),
        ).catch(() => undefined);

        // Update the review message
        const channel = await interaction.client.channels.fetch(record.reviewChannelId).catch(() => null);
        if (channel?.isSendable()) {
            const reviewMessage = await channel.messages.fetch(record.reviewMessageId).catch(() => null);
            if (reviewMessage) {
                const updatedEmbed = brandedEmbed(`⚖️ Ban Appeal | ${appealId}`, 0x22c55e)
                    .setDescription('This ban appeal has been **approved**.')
                    .addFields(
                        { name: 'Appeal ID', value: appealId, inline: true },
                        { name: 'Discord User', value: `<@${record.userId}>`, inline: true },
                        { name: 'Status', value: '✅ Approved', inline: true },
                        { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                    );
                await reviewMessage.edit({ embeds: [updatedEmbed], components: [] });
            }
        }

        await interaction.editReply(`Appeal **${appealId}** has been approved and the user has been notified.`);
        return true;
    }

    if (action === 'deny' && appealId) {
        await interaction.showModal(denyReasonModal(appealId));
        return true;
    }

    return false;
}

/**
 * Routes ban-appeal modal submissions. Returns false for unrelated modals.
 */
export async function handleBanAppealModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ban-appeal:')) return false;

    const [, action, appealId] = interaction.customId.split(':');
    if (action !== 'deny-modal' || !appealId) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.fields.getTextInputValue('deny-reason');
    const record = await BanAppeal.findOne({ appealId }).lean().exec().catch(() => null);
    if (!record) {
        await interaction.editReply('This appeal could not be found.');
        return true;
    }
    if (record.status !== 'Pending') {
        await interaction.editReply(`This appeal has already been ${record.status.toLowerCase()}.`);
        return true;
    }

    await BanAppeal.updateOne(
        { appealId },
        { $set: { status: 'Denied', reviewedById: interaction.user.id, reviewReason: reason, updatedAt: new Date() } },
    ).exec().catch(() => undefined);

    // DM the user with the denial reason
    const deniedEmbed = brandedEmbed('❌ Ban Appeal Denied')
        .setDescription('Unfortunately, your ban appeal has been **denied**.')
        .addFields(
            { name: 'Reason', value: reason },
            { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
        );
    await interaction.client.users.fetch(record.userId).then(user =>
        user.send({ embeds: [deniedEmbed], files: [createLogoAttachment()] }),
    ).catch(() => undefined);

    // Update the review message
    const channel = await interaction.client.channels.fetch(record.reviewChannelId).catch(() => null);
    if (channel?.isSendable()) {
        const reviewMessage = await channel.messages.fetch(record.reviewMessageId).catch(() => null);
        if (reviewMessage) {
            const updatedEmbed = brandedEmbed(`⚖️ Ban Appeal | ${appealId}`, 0xef4444)
                .setDescription('This ban appeal has been **denied**.')
                .addFields(
                    { name: 'Appeal ID', value: appealId, inline: true },
                    { name: 'Discord User', value: `<@${record.userId}>`, inline: true },
                    { name: 'Status', value: '❌ Denied', inline: true },
                    { name: 'Denial Reason', value: reason },
                    { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                );
            await reviewMessage.edit({ embeds: [updatedEmbed], components: [] });
        }
    }

    await interaction.editReply(`Appeal **${appealId}** has been denied and the user has been notified.`);
    return true;
}