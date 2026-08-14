import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
    type GuildMember,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { logger } from '../utils/logger';

const LOA_REQUEST_CHANNEL_ID = process.env.LOA_REQUEST_CHANNEL_ID || '1528206019237515344';
const LOA_ROLE_ID = process.env.LOA_ROLE_ID || '1521593407795888329';
// Only members holding this role may submit an LOA request when configured.
const LOA_REQUESTER_ROLE_ID = process.env.LOA_REQUESTER_ROLE_ID || '';
const LOA_REQUESTER_ROLE_REQUIRED = Boolean(process.env.LOA_REQUESTER_ROLE_ID);
const LOA_MANAGEMENT_PERMISSION = PermissionFlagsBits.Administrator;
// Roles that can approve/deny LOA requests (in addition to Administrator)
const LOA_MANAGEMENT_ROLE_IDS = Array.from(new Set([
    process.env.BOT_PERMISSIONS_ROLE_ID,
    process.env.ADMIN_ROLE_ID,
    process.env.INFRACTION_AUTHORIZED_ROLE_ID,
    ...(process.env.LOA_MANAGEMENT_ROLE_IDS || '').split(','),
].map(value => value?.trim()).filter((value): value is string => Boolean(value))));

interface PendingLoa {
    guildId: string;
    userId: string;
    memberUsername: string;
    name: string;
    startDate: string;
    endDate: string;
    reason: string;
    requestedAt: string;
    approvedBy?: string;
    channelId?: string;
    messageId?: string;
    timer: NodeJS.Timeout;
}

interface ActiveLoa {
    guildId: string;
    userId: string;
    memberUsername: string;
    name: string;
    startDate: string;
    endDate: string;
    reason: string;
    approvedAt: string;
    expiredAt: string;
    timer?: NodeJS.Timeout;
}

const inMemoryPending: Map<string, PendingLoa> = new Map();
const inMemoryActive: Map<string, ActiveLoa> = new Map();
const processingPendingIds: Set<string> = new Set();

type RecoverableLoaEmbed = {
    title?: string | null;
    timestamp?: string | null;
    fields?: readonly { name: string; value: string }[];
};

function pendingExpiryTimer(pendingId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
        if (inMemoryPending.has(pendingId)) inMemoryPending.delete(pendingId);
    }, 7 * 24 * 60 * 60 * 1_000);
    timer.unref?.();
    return timer;
}

function fieldValue(embed: RecoverableLoaEmbed, name: string): string {
    return embed.fields?.find(field => field.name.toLowerCase() === name.toLowerCase())?.value.trim() || '';
}

function storedDate(value: string): string {
    const discordTimestamp = value.match(/^<t:(\d+)(?::[A-Za-z])?>$/)?.[1];
    return discordTimestamp
        ? new Date(Number(discordTimestamp) * 1_000).toISOString()
        : value;
}

/**
 * Rebuild a pending request from the still-visible Discord review message.
 * LOA buttons outlive process memory, so a restart must not make a genuinely
 * pending request look as though it was already approved or denied.
 */
function recoverPendingFromMessage(interaction: ButtonInteraction, pendingId: string): PendingLoa | null {
    if (!interaction.guildId) return null;
    const message = interaction.message;
    const embed = message.embeds.find(candidate => /LOA Request Submitted/i.test(candidate.title || ''));
    if (!embed) return null;

    const requestedBy = fieldValue(embed, 'Requested By');
    const userId = requestedBy.match(/<@!?(\d{17,20})>/)?.[1];
    const name = fieldValue(embed, 'Name');
    const startDate = storedDate(fieldValue(embed, 'Start Date'));
    const endDate = storedDate(fieldValue(embed, 'End Date'));
    const reason = fieldValue(embed, 'Reason');
    if (!userId || !name || !startDate || !endDate || !reason || !pendingId.startsWith(`${userId}-`)) return null;

    const requestedAt = storedDate(fieldValue(embed, 'Submitted At'))
        || embed.timestamp
        || message.createdAt?.toISOString()
        || new Date().toISOString();
    const pending: PendingLoa = {
        guildId: interaction.guildId,
        userId,
        memberUsername: name,
        name,
        startDate,
        endDate,
        reason,
        requestedAt,
        channelId: message.channelId,
        messageId: message.id,
        timer: pendingExpiryTimer(pendingId),
    };
    inMemoryPending.set(pendingId, pending);
    logger.info(`Recovered pending LOA ${pendingId} from its Discord review message after a restart.`);
    return pending;
}

function pendingTimestamp(loa: PendingLoa): string {
    return `<t:${Math.floor(new Date(loa.requestedAt).getTime() / 1000)}:F>`;
}

function dateTimestamp(dateText: string): string {
    const parsed = new Date(dateText);
    if (Number.isNaN(parsed.getTime())) return dateText;
    return `<t:${Math.floor(parsed.getTime() / 1000)}:F>`;
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

function reviewActionRows(pendingId: string): ActionRowBuilder<ButtonBuilder>[] {
    const id = (action: string) => `loa:review:${action}:${pendingId}`;
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(id('approve')).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(id('deny')).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger),
        ),
    ];
}

function loaRequestModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('loa:request:modal')
        .setTitle('Leave of Absence Request')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Your Name')
                    .setPlaceholder('e.g. John Smith')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('start_date')
                    .setLabel('Start Date')
                    .setPlaceholder('e.g. July 1, 2026 or 2026-07-01')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('end_date')
                    .setLabel('End Date')
                    .setPlaceholder('e.g. July 15, 2026 or 2026-07-15')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason for LOA')
                    .setPlaceholder('Why do you need a leave of absence?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setRequired(true),
            ),
        );
}

function requestEmbed(pending: PendingLoa): EmbedBuilder {
    return brandedEmbed('📝 LOA Request Submitted')
        .addFields(
            { name: 'Requested By', value: `<@${pending.userId}>`, inline: true },
            { name: 'Name', value: pending.name, inline: true },
            { name: 'Start Date', value: dateTimestamp(pending.startDate), inline: true },
            { name: 'End Date', value: dateTimestamp(pending.endDate), inline: true },
            { name: 'Reason', value: pending.reason },
            { name: 'Submitted At', value: pendingTimestamp(pending), inline: true },
        );
}

function approvedEmbed(active: ActiveLoa): EmbedBuilder {
    return brandedEmbed('✅ LOA Approved', 0x22c55e)
        .addFields(
            { name: 'Member', value: `<@${active.userId}>`, inline: true },
            { name: 'Name', value: active.name, inline: true },
            { name: 'Start Date', value: dateTimestamp(active.startDate), inline: true },
            { name: 'End Date', value: dateTimestamp(active.endDate), inline: true },
            { name: 'Approved At', value: dateTimestamp(active.approvedAt), inline: true },
            { name: 'Role', value: `<@&${LOA_ROLE_ID}>`, inline: true },
        );
}

function deniedEmbed(memberUsername: string): EmbedBuilder {
    return brandedEmbed('❌ LOA Denied', 0xef4444)
        .setDescription(`Your Leave of Absence request, **${memberUsername}**, was not approved. Please contact management if you believe this is a mistake.`);
}

type AnyClient = ChatInputCommandInteraction['client'] | ButtonInteraction['client'] | ModalSubmitInteraction['client'];

async function fetchMember(guildId: string, userId: string, botClient: AnyClient): Promise<GuildMember | null> {
    try {
        const guild = await botClient.guilds.fetch(guildId).catch(() => null);
        if (!guild) return null;
        return await guild.members.fetch(userId).catch(() => null);
    } catch {
        return null;
    }
}

async function assignLoaRole(member: GuildMember): Promise<boolean> {
    try {
        if (!LOA_ROLE_ID) return false;
        await member.roles.add(LOA_ROLE_ID, 'LOA approved');
        logger.info(`Assigned LOA role (${LOA_ROLE_ID}) to ${member.user.tag} (${member.id}).`);
        return true;
    } catch (error) {
        logger.warn(`Could not assign LOA role to ${member.user.tag} (${member.id}): ${error instanceof Error ? error.message : 'Unknown'}`);
        return false;
    }
}

async function removeLoaRole(member: GuildMember): Promise<boolean> {
    try {
        if (!LOA_ROLE_ID) return false;
        await member.roles.remove(LOA_ROLE_ID, 'LOA period ended');
        logger.info(`Removed LOA role (${LOA_ROLE_ID}) from ${member.user.tag} (${member.id}).`);
        return true;
    } catch (error) {
        logger.warn(`Could not remove LOA role from ${member.user.tag} (${member.id}): ${error instanceof Error ? error.message : 'Unknown'}`);
        return false;
    }
}

function scheduleLoaExpiry(active: ActiveLoa, client: AnyClient): void {
    const endTime = Date.parse(active.endDate);
    if (Number.isNaN(endTime)) return;
    const delay = Math.max(endTime - Date.now(), 1_000);
    const timer = setTimeout(async () => {
        const member = await fetchMember(active.guildId, active.userId, client).catch(() => null);
        if (member) await removeLoaRole(member);
        inMemoryActive.delete(active.userId);
        logger.info(`LOA for ${active.memberUsername} (${active.userId}) has expired; LOA role removed.`);
    }, delay);
    // Allow the timer to keep Node alive for short leaves, but not block graceful shutdown on long ones.
    if (delay < 2_147_483_647) timer.unref?.();
    active.expiredAt = new Date(endTime).toISOString();
    active.timer = timer;
}

async function sendApprovalConfirmation(member: GuildMember, active: ActiveLoa): Promise<void> {
    const dmEmbed = brandedEmbed('✅ Your LOA Has Been Approved', 0x22c55e)
        .setDescription(`Congratulations **${active.name}**, your Leave of Absence has been approved!`)
        .addFields(
            { name: 'Start Date', value: dateTimestamp(active.startDate), inline: true },
            { name: 'End Date', value: dateTimestamp(active.endDate), inline: true },
        );
    await member.send({ embeds: [dmEmbed], files: [createLogoAttachment()] }).catch(() => {
        logger.warn(`Could not send LOA approval DM to ${member.user.tag} (${member.id}).`);
    });
}

async function sendDenialConfirmation(member: GuildMember, pending: PendingLoa, reviewedBy: string): Promise<void> {
    const dmEmbed = brandedEmbed('❌ Your LOA Was Denied', 0xef4444)
        .setDescription(`We are sorry, **${pending.name}**, your Leave of Absence request was not approved.`)
        .addFields(
            { name: 'Requested Start', value: dateTimestamp(pending.startDate), inline: true },
            { name: 'Requested End', value: dateTimestamp(pending.endDate), inline: true },
            { name: 'Reviewed By', value: `<@${reviewedBy}>`, inline: true },
        );
    await member.send({ embeds: [dmEmbed], files: [createLogoAttachment()] }).catch(() => {
        logger.warn(`Could not send LOA denial DM to ${member.user.tag} (${member.id}).`);
    });
}

async function deleteOriginalRequest(pending: PendingLoa, client: AnyClient): Promise<void> {
    if (!pending.channelId || !pending.messageId) return;
    try {
        const channel = await client.channels.fetch(pending.channelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        const message = await channel.messages.fetch(pending.messageId).catch(() => null);
        if (message) await message.delete().catch(() => undefined);
    } catch {
        logger.warn(`LOA: could not delete original request message for ${pending.userId}.`);
    }
}

export async function handleLoaButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('loa:')) return false;

    if (interaction.customId === 'loa:request:open') {
        await interaction.showModal(loaRequestModal());
        return true;
    }

    if (interaction.customId.startsWith('loa:review:')) {
        const parts = interaction.customId.split(':');
        const action = parts[2];
        const pendingId = parts.slice(3).join(':');

        if (!['approve', 'deny'].includes(action)) return false;
        const pending = inMemoryPending.get(pendingId) || recoverPendingFromMessage(interaction, pendingId);
        if (!pending) {
            await interaction.reply({
                content: 'This LOA request could not be recovered from its review message. Please submit a new request.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Allow users with Administrator permission OR any configured management role
            const hasAdmin = interaction.memberPermissions?.has(LOA_MANAGEMENT_PERMISSION);
            const interactionMember = interaction.member;
            const hasRole = (id: string): boolean => {
                if (!interactionMember) return false;
                const roles = (interactionMember as { roles?: { cache?: { has(id: string): boolean } } | string[] }).roles;
                if (!roles) return false;
                if (Array.isArray(roles)) return roles.includes(id);
                return roles.cache?.has(id) ?? false;
            };
            const hasManagementRole = LOA_MANAGEMENT_ROLE_IDS.some(hasRole);

            if (!hasAdmin && !hasManagementRole) {
                await interaction.editReply('Only management may approve or deny LOA requests.');
                return true;
            }

            if (processingPendingIds.has(pendingId)) {
                await interaction.editReply('This LOA request is currently being processed by another reviewer.');
                return true;
            }
            processingPendingIds.add(pendingId);

            pending.approvedBy = interaction.user.id;

            const member = await fetchMember(pending.guildId, pending.userId, interaction.client);

            if (action === 'approve') {
                const active: ActiveLoa = {
                    guildId: pending.guildId,
                    userId: pending.userId,
                    memberUsername: pending.memberUsername,
                    name: pending.name,
                    startDate: pending.startDate,
                    endDate: pending.endDate,
                    reason: pending.reason,
                    approvedAt: new Date().toISOString(),
                    expiredAt: '',
                };

                let roleAssigned = false;
                if (member) {
                    roleAssigned = await assignLoaRole(member);
                    await sendApprovalConfirmation(member, active);
                } else {
                    logger.warn(`LOA approve: member ${pending.userId} not found in guild ${pending.guildId}.`);
                }

                inMemoryActive.set(pending.userId, active);
                scheduleLoaExpiry(active, interaction.client);

                const channel = await interaction.client.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null);
                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${pending.userId}>`,
                        embeds: [approvedEmbed(active)],
                        files: [createLogoAttachment()],
                        allowedMentions: { parse: [], users: [pending.userId] },
                    }).catch(error => {
                        logger.warn(`Could not post the approved LOA for ${pending.userId}: ${error instanceof Error ? error.message : 'Unknown'}`);
                    });
                }

                clearTimeout(pending.timer);
                inMemoryPending.delete(pendingId);
                // Remove the request message only after the decision has been
                // applied, so a mid-review failure never loses the request.
                await deleteOriginalRequest(pending, interaction.client);

                const roleMessage = roleAssigned ? 'the LOA role was assigned' : '⚠️ the LOA role could NOT be assigned';
                await interaction.editReply(`✅ LOA for **${pending.name}** approved. The member was notified, ${roleMessage}, and the approved LOA was posted to <#${LOA_REQUEST_CHANNEL_ID}>.`);
                return true;
            }

            if (action === 'deny') {
                if (member) {
                    await sendDenialConfirmation(member, pending, interaction.user.id);
                } else {
                    logger.warn(`LOA deny: member ${pending.userId} not found in guild ${pending.guildId}.`);
                }

                const channel = await interaction.client.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null);
                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${pending.userId}>`,
                        embeds: [deniedEmbed(pending.memberUsername)],
                        files: [createLogoAttachment()],
                        allowedMentions: { parse: [], users: [pending.userId] },
                    }).catch(error => {
                        logger.warn(`Could not post the denied LOA for ${pending.userId}: ${error instanceof Error ? error.message : 'Unknown'}`);
                    });
                }

                clearTimeout(pending.timer);
                inMemoryPending.delete(pendingId);
                await deleteOriginalRequest(pending, interaction.client);

                await interaction.editReply(`❌ LOA for **${pending.name}** was denied. The member was notified.`);
                return true;
            }
        } catch (error) {
            logger.error(`LOA review failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            await interaction.editReply('Unable to process this LOA review right now. Please try again later.');
            return true;
        } finally {
            processingPendingIds.delete(pendingId);
        }
    }

    return false;
}

export async function handleLoaModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId !== 'loa:request:modal') return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const name = interaction.fields.getTextInputValue('name').trim();
        const startDate = interaction.fields.getTextInputValue('start_date').trim();
        const endDate = interaction.fields.getTextInputValue('end_date').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        if (!interaction.guildId || !interaction.guild) {
            await interaction.editReply('This command can only be used in a server.');
            return true;
        }
        if (!name || !startDate || !endDate || !reason) {
            await interaction.editReply('All fields are required. Please submit the form again.');
            return true;
        }

        const pendingId = `${interaction.user.id}-${Date.now()}`;
        const pending: PendingLoa = {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            memberUsername: interaction.user.username,
            name,
            startDate,
            endDate,
            reason,
            requestedAt: new Date().toISOString(),
            timer: pendingExpiryTimer(pendingId),
        };
        inMemoryPending.set(pendingId, pending);

        const channel = await interaction.client.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.isSendable()) {
            inMemoryPending.delete(pendingId);
            clearTimeout(pending.timer);
            await interaction.editReply(
                `The LOA request channel (<#${LOA_REQUEST_CHANNEL_ID}>) is unavailable. Please ensure the bot has **View Channel** and **Send Messages** permission there, then try again. If the problem continues, contact an administrator.`,
            );
            return true;
        }

        const sent = await channel.send({
            content: `<@${interaction.user.id}>`,
            embeds: [requestEmbed(pending)],
            components: reviewActionRows(pendingId),
            files: [createLogoAttachment()],
            allowedMentions: { parse: [], users: [interaction.user.id] },
        });
        pending.channelId = channel.id;
        pending.messageId = sent.id;

        await interaction.editReply('✅ Your LOA request has been submitted for review. You will be notified once management decides.');
        return true;
    } catch (error) {
        console.error('[LOA] Modal failed.', error);
        await interaction.editReply('Unable to submit the LOA request. Please try again later.');
        return true;
    }
}

export const loaCommand = {
    data: new SlashCommandBuilder()
        .setName('loa')
        .setDescription('Request a Leave of Absence')
        .addSubcommand(subcommand =>
            subcommand
                .setName('request')
                .setDescription('Open the Leave of Absence request form'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'request') {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
                    return;
                }

                // Only users holding the LOA requester role (or with Administrator)
                // may submit a Leave of Absence request.
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
                const member = interaction.member;
                const memberHasRole = (id: string): boolean => {
                    if (!member) return false;
                    const roles = (member as { roles?: { cache?: { has(id: string): boolean } } | string[] }).roles;
                    if (!roles) return false;
                    if (Array.isArray(roles)) return roles.includes(id);
                    return roles.cache?.has(id) ?? false;
                };
                const hasRequesterRole = LOA_REQUESTER_ROLE_REQUIRED && memberHasRole(LOA_REQUESTER_ROLE_ID);

                if (!isAdmin && LOA_REQUESTER_ROLE_REQUIRED && !hasRequesterRole) {
                    await interaction.reply({
                        content: `You need the <@&${LOA_REQUESTER_ROLE_ID}> role to request a Leave of Absence.`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                await interaction.showModal(loaRequestModal());
                return;
            }
        } catch (error) {
            console.error('[LOA] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.reply({ content: 'Unable to process the LOA command. Please try again later.', flags: MessageFlags.Ephemeral });
        }
    },
};
