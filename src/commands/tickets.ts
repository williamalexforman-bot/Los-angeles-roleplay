import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GuildMember,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND, CHANNEL_IDS, SUPPORT_ROLE_IDS, TICKET_CATEGORY_IDS, type TicketCategory } from '../config/constants';
import { type TicketRecord } from '../database/models';
import { createLogoAttachment } from '../utils/embeds';
import { logger } from '../utils/logger';
import { lookupBloxlinkUser, type BloxlinkLookupResult } from '../services/bloxlinkService';
import { generateTicketAssistantReply, type TicketConversationMessage } from '../services/aiService';
import {
    activateTicket,
    claimOpenTicket,
    getTicketByChannel,
    releaseTicketReservation,
    removeTicketRecord,
    reserveTicket,
    safelyGetTicketByChannel,
    setOpeningMessage,
    updateTicket,
} from '../services/ticketRepository';

const PANEL_DESCRIPTION = `Welcome to Los Angeles Roleplay support system!

If you have any issue, select the correct department from the dropdown below.

After selecting an option, you must provide a clear reason for opening your ticket.

We have created ticket categories to make it easier and faster for us to solve your problem, so choose the right type of ticket!

Please do not troll in the tickets. If caught trolling you will be punished.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎫 **General Support**
› General questions
› Server information

📋 **Internal Affairs Support**
› Staff report
› Application inquiries

🏛️ **Management Support**
› High Rank+ report
› Perk claim
› Prize claim
› Paid advertisement
› Staff transfers
› Staff fast passes

⭐ **High-Rank Support**
› Prize / Payment claim
› Marketplace concerns
› Ownership Questions`;

interface TicketCategoryDefinition {
    key: TicketCategory;
    label: string;
    title: string;
    emoji: string;
    menuDescription: string;
    categoryId: string;
    supportRoleId: string;
}

const ticketCategories: Record<TicketCategory, TicketCategoryDefinition> = {
    general: {
        key: 'general',
        label: 'General Support',
        title: '🎫 General Support',
        emoji: '🎫',
        menuDescription: 'General questions and server information',
        categoryId: TICKET_CATEGORY_IDS.general,
        supportRoleId: SUPPORT_ROLE_IDS.general,
    },
    internal: {
        key: 'internal',
        label: 'Internal Affairs',
        title: '📋 Internal Affairs Support',
        emoji: '📋',
        menuDescription: 'Staff reports, applications, and partnerships',
        categoryId: TICKET_CATEGORY_IDS.internal,
        supportRoleId: SUPPORT_ROLE_IDS.internal,
    },
    management: {
        key: 'management',
        label: 'Management',
        title: '🏛️ Management Support',
        emoji: '🏛️',
        menuDescription: 'Claims, advertisements, transfers, and staff matters',
        categoryId: TICKET_CATEGORY_IDS.management,
        supportRoleId: SUPPORT_ROLE_IDS.management,
    },
    highrank: {
        key: 'highrank',
        label: 'High-Rank',
        title: '⭐ High-Rank Support',
        emoji: '⭐',
        menuDescription: 'Payments, marketplace concerns, and ownership questions',
        categoryId: TICKET_CATEGORY_IDS.highrank,
        supportRoleId: SUPPORT_ROLE_IDS.highrank,
    },
};

const ticketCategoryKeys = Object.keys(ticketCategories) as TicketCategory[];

function isTicketCategory(value: string): value is TicketCategory {
    return ticketCategoryKeys.includes(value as TicketCategory);
}

function panelDropdown(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('Select a support department')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(ticketCategoryKeys.map(key => ({
                label: ticketCategories[key].label,
                value: key,
                description: ticketCategories[key].menuDescription,
                emoji: ticketCategories[key].emoji,
            }))),
    );
}

function ticketPanelEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle('Help & Support')
        .setDescription(PANEL_DESCRIPTION)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.panelFooter });
}

/** Updates existing bot-authored panels without posting duplicates during restarts. */
export async function refreshExistingTicketPanels(client: Client): Promise<number> {
    const panelChannel = await client.channels.fetch(CHANNEL_IDS.ticketPanel).catch(() => null);
    if (!(panelChannel instanceof TextChannel) || !client.user) return 0;

    const recentMessages = await panelChannel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recentMessages) return 0;
    const existingPanels = recentMessages.filter(message =>
        message.author.id === client.user?.id
        && message.embeds.some(embed => embed.title === 'Help & Support'),
    );

    let updated = 0;
    for (const message of existingPanels.values()) {
        const hasLogo = message.attachments.some(attachment => attachment.name === BRAND.logoName);
        await message.edit({
            embeds: [ticketPanelEmbed()],
            components: [panelDropdown()],
            ...(hasLogo ? {} : { files: [createLogoAttachment()] }),
        });
        updated += 1;
    }
    return updated;
}

function hasPanelPermission(member: GuildMember): boolean {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(roleId && member.roles.cache.has(roleId));
}

async function fetchInteractionMember(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): Promise<GuildMember | null> {
    if (!interaction.guild) return null;
    return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

function isTicketStaff(member: GuildMember | null, ticket: TicketRecord): boolean {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.roles.cache.has(ticket.supportRoleId)
        || Boolean(process.env.BOT_PERMISSIONS_ROLE_ID && member.roles.cache.has(process.env.BOT_PERMISSIONS_ROLE_ID));
}

function formatLongDate(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function sanitizeChannelName(value: string): string {
    // Preserve emojis, letters, numbers, spaces, hyphens, and underscores
    // Discord channel names accept Unicode (including emojis) up to 100 characters
    let sanitized = value
        .trim()
        .toLowerCase()
        // Replace characters that are problematic for Discord channel names
        .replace(/[<>:"/\\|?*]+/g, '')
        // Collapse multiple spaces/hyphens
        .replace(/[-\s]{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .trim();
    // Fall back if empty after sanitization
    if (!sanitized) return 'ticket';
    return sanitized.slice(0, 100);
}

function splitText(value: string, maximum = 1_024): string[] {
    const text = value || 'Not provided';
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maximum) {
        let splitAt = remaining.lastIndexOf('\n', maximum - 1);
        if (splitAt < maximum / 2) splitAt = remaining.lastIndexOf(' ', maximum - 1);
        if (splitAt >= maximum / 2) splitAt += 1;
        else splitAt = maximum;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
    }
    chunks.push(remaining || 'Not provided');
    return chunks;
}

function answerLabels(ticket: TicketRecord): Array<[string, string]> {
    if (ticket.category === 'internal') {
        return [
            ['Reported Person', ticket.answers.reportedPerson || 'Not provided'],
            ['Report Reason', ticket.answers.reportReason || 'Not provided'],
            ['Proof', /^no[.!]?$/i.test(ticket.answers.proof?.trim() || '') ? 'No proof supplied' : ticket.answers.proof || 'No proof supplied'],
            ['Additional Information', ticket.answers.additional || 'Not provided'],
        ];
    }
    return [
        ['Reason', ticket.answers.reason || 'Not provided'],
        ['Additional Information', ticket.answers.additional || 'Not provided'],
    ];
}

function robloxInfoValue(info: Partial<BloxlinkLookupResult>): string {
    if (info.status !== 'verified' || !info.verified) {
        if (info.status === 'service_unavailable') {
            return [
                '**Roblox verification could not be checked yet.**',
                '*The verification service is temporarily unavailable. Staff can use Refresh Roblox Info after it is restored.*',
            ].join('\n');
        }
        return 'No verified Roblox account found';
    }
    const profile = info.profileUrl ? `[View Roblox profile](${info.profileUrl})` : 'Unavailable';
    const created = info.robloxCreatedAt ? formatLongDate(new Date(info.robloxCreatedAt)) : 'Unavailable';
    return [
        `**Roblox Username:** ${info.robloxUsername || 'Unavailable'}`,
        `**Roblox Display Name:** ${info.robloxDisplayName || 'Unavailable'}`,
        `**Roblox ID:** ${info.robloxId || 'Unavailable'}`,
        `**Roblox Profile:** ${profile}`,
        `**Created:** ${created}`,
        `**Verification Source:** ${info.verificationSource || 'Bloxlink'}`,
    ].join('\n');
}

/** Keeps last-known verified identity data when a refresh fails transiently. */
export function mergeRobloxRefreshResult(
    previous: Record<string, unknown> | undefined,
    latest: BloxlinkLookupResult,
): BloxlinkLookupResult {
    if (latest.status !== 'service_unavailable' || previous?.status !== 'verified' || previous.verified !== true) {
        return latest;
    }

    const robloxId = typeof previous.robloxId === 'string' ? previous.robloxId : '';
    if (!/^\d+$/.test(robloxId)) return latest;
    const optionalString = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
    return {
        status: 'verified',
        verified: true,
        robloxId,
        robloxUsername: optionalString(previous.robloxUsername),
        robloxDisplayName: optionalString(previous.robloxDisplayName),
        robloxAvatarUrl: optionalString(previous.robloxAvatarUrl),
        robloxCreatedAt: optionalString(previous.robloxCreatedAt),
        profileUrl: optionalString(previous.profileUrl) || `https://www.roblox.com/users/${robloxId}/profile`,
        verificationSource: 'Bloxlink',
        warnings: Array.isArray(previous.warnings)
            ? previous.warnings.filter((warning): warning is string => typeof warning === 'string')
            : [],
    };
}

function discordInfoValue(ticket: TicketRecord): string {
    const username = String(ticket.discordInfo?.username || 'Unavailable');
    const createdAt = ticket.discordInfo?.createdAt ? new Date(String(ticket.discordInfo.createdAt)) : null;
    return [
        `**Discord Username:** ${username}`,
        `**Discord ID:** ${ticket.creatorId}`,
        `**Account Created:** ${createdAt && !Number.isNaN(createdAt.getTime()) ? formatLongDate(createdAt) : 'Unavailable'}`,
        `**Ticket ID:** #${ticket.number}`,
    ].join('\n');
}

export function buildOpeningEmbeds(ticket: TicketRecord, fallbackAvatarUrl: string): EmbedBuilder[] {
    const category = ticketCategories[ticket.category];
    const roblox = (ticket.robloxInfo || {}) as Partial<BloxlinkLookupResult>;
    const answerChunks = answerLabels(ticket).map(([label, value]) => ({ label, chunks: splitText(value) }));
    const first = new EmbedBuilder()
        .setColor(BRAND.color)
        .setAuthor({ name: BRAND.name, iconURL: BRAND.logoUrl })
        .setTitle(category.title)
        .setDescription('Thank you for creating a support ticket.\nOur team will be with you shortly.\nPlease patiently wait while our team reviews your inquiry.')
        .setThumbnail(roblox.status === 'verified' && roblox.robloxAvatarUrl ? roblox.robloxAvatarUrl : fallbackAvatarUrl)
        .addFields(...answerChunks.map(item => ({ name: item.label, value: item.chunks[0] })))
        .addFields(
            { name: 'Discord Information', value: discordInfoValue(ticket) },
            { name: 'Roblox Information', value: robloxInfoValue(roblox) },
            { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Not Claimed' },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp(ticket.createdAt);

    const overflowFields = answerChunks.flatMap(item => item.chunks.slice(1).map((chunk, index) => ({
        name: `${item.label} (continued${item.chunks.length > 2 ? ` ${index + 2}` : ''})`,
        value: chunk,
    })));
    const embeds = [first];
    for (let index = 0; index < overflowFields.length; index += 5) {
        embeds.push(new EmbedBuilder()
            .setColor(BRAND.color)
            .setAuthor({ name: BRAND.name, iconURL: BRAND.logoUrl })
            .setTitle(`${category.title} — Submitted Details`)
            .setThumbnail(BRAND.logoUrl)
            .addFields(...overflowFields.slice(index, index + 5))
            .setFooter({ text: BRAND.footer })
            .setTimestamp(ticket.createdAt));
    }
    return embeds;
}

function ticketControlRows(ticket: TicketRecord, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
    const rows = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('ticket:control:claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:unclaim').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:close_reason').setLabel('Close With Reason').setStyle(ButtonStyle.Danger).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:escalate').setLabel('Request Human Staff').setEmoji('🚨').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('ticket:control:add_user').setLabel('Add User').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:remove_user').setLabel('Remove User').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:rename').setLabel('Rename').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:transcript').setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId('ticket:control:toggle_ai').setLabel(ticket.aiEnabled ? 'Disable AI' : 'Enable AI').setEmoji('🤖').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        ),
    ];
    const roblox = (ticket.robloxInfo || {}) as Partial<BloxlinkLookupResult>;
    if (roblox.status !== 'verified') {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('ticket:control:refresh_roblox').setLabel('Refresh Roblox Info').setEmoji('🔄').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        ));
    }
    return rows;
}

export async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in the LARP server.', ephemeral: true });
        return;
    }
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    if (!guild) return;
    const member = await fetchInteractionMember(interaction);
    if (!member || !hasPanelPermission(member)) {
        await interaction.editReply('You must be a server administrator or hold the configured bot-permissions role.');
        return;
    }

    const panelChannel = await guild.channels.fetch(CHANNEL_IDS.ticketPanel).catch(() => null);
    if (!panelChannel?.isSendable()) {
        await interaction.editReply('The configured ticket panel channel is unavailable or is not text-based.');
        return;
    }

    const refreshedPanels = await refreshExistingTicketPanels(interaction.client);
    if (refreshedPanels > 0) {
        await interaction.editReply(`Updated ${refreshedPanels} ticket panel${refreshedPanels === 1 ? '' : 's'} in <#${CHANNEL_IDS.ticketPanel}>.`);
        return;
    }

    await panelChannel.send({
        embeds: [ticketPanelEmbed()],
        components: [panelDropdown()],
        files: [createLogoAttachment()],
    });
    await interaction.editReply(`The professional ticket panel was posted in <#${CHANNEL_IDS.ticketPanel}>.`);
}

export function ticketOpeningModal(category: TicketCategory): ModalBuilder {
    const definition = ticketCategories[category];
    const modal = new ModalBuilder().setCustomId(`ticket:create:${category}`).setTitle(`${definition.label} Ticket`);
    if (category === 'internal') {
        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('reported_person').setLabel('Who are you reporting?').setStyle(TextInputStyle.Short).setMaxLength(4000).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('report_reason').setLabel('What is the reason for the report?').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('proof').setLabel('Proof link (or type “No”)').setPlaceholder('Do you have proof? Paste the evidence link or type “No.”').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('additional').setLabel('Additional information').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false)),
        );
    } else {
        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('reason').setLabel('Reason for opening this ticket').setPlaceholder('What is the reason for opening this ticket?').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('additional').setLabel('Additional information').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false)),
        );
    }
    return modal;
}

export function ticketOpeningModalForValue(value: string): ModalBuilder | null {
    return isTicketCategory(value) ? ticketOpeningModal(value) : null;
}

function modalAnswers(interaction: ModalSubmitInteraction, category: TicketCategory): Record<string, string> {
    if (category === 'internal') {
        return {
            reportedPerson: interaction.fields.getTextInputValue('reported_person'),
            reportReason: interaction.fields.getTextInputValue('report_reason'),
            proof: interaction.fields.getTextInputValue('proof'),
            additional: interaction.fields.getTextInputValue('additional') || 'Not provided',
        };
    }
    return {
        reason: interaction.fields.getTextInputValue('reason'),
        additional: interaction.fields.getTextInputValue('additional') || 'Not provided',
    };
}

async function sendTicketCreationLog(ticket: TicketRecord, channel: TextChannel): Promise<void> {
    try {
        const logChannel = await channel.client.channels.fetch(CHANNEL_IDS.discordCommandLog).catch(() => null);
        if (!logChannel?.isSendable()) return;
        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('Ticket Created')
            .setThumbnail(BRAND.logoUrl)
            .addFields(
                { name: 'Ticket', value: `#${ticket.number}`, inline: true },
                { name: 'Category', value: ticketCategories[ticket.category].label, inline: true },
                { name: 'Creator', value: `<@${ticket.creatorId}>`, inline: true },
                { name: 'Channel', value: `${channel}`, inline: true },
            )
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        await logChannel.send({ embeds: [embed], files: [createLogoAttachment()] });
    } catch (error) {
        logger.warn(`Ticket creation audit unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function createTicketFromModal(interaction: ModalSubmitInteraction, category: TicketCategory): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the LARP server.', ephemeral: true });
        return;
    }
    await interaction.deferReply({ ephemeral: true });
    const definition = ticketCategories[category];
    const answers = modalAnswers(interaction, category);
    const pendingRobloxInfo: BloxlinkLookupResult = {
        status: 'service_unavailable',
        verified: false,
        robloxId: null,
        robloxUsername: null,
        robloxDisplayName: null,
        robloxAvatarUrl: null,
        robloxCreatedAt: null,
        profileUrl: null,
        verificationSource: 'Bloxlink',
        reason: 'network_error',
        message: 'Bloxlink verification lookup is pending.',
    };

    const reservation = await reserveTicket({
        guildId: interaction.guild.id,
        creatorId: interaction.user.id,
        category,
        supportRoleId: definition.supportRoleId,
        answers,
        discordInfo: {
            username: interaction.user.tag,
            createdAt: interaction.user.createdAt.toISOString(),
            avatarUrl: interaction.user.displayAvatarURL({ size: 256 }),
        },
        robloxInfo: { ...pendingRobloxInfo },
    });
    if (reservation.duplicate) {
        const location = reservation.duplicate.channelId.startsWith('pending:') ? 'is currently being created' : `already exists: <#${reservation.duplicate.channelId}>`;
        await interaction.editReply(`You already have an open ${definition.label} ticket that ${location}.`);
        return;
    }
    if (!reservation.ticket) throw new Error('Unable to reserve a ticket number.');

    const pendingId = reservation.ticket.channelId;
    let reservedTicket = reservation.ticket;
    let channel: TextChannel | null = null;
    try {
        let robloxInfo: BloxlinkLookupResult;
        try {
            robloxInfo = await lookupBloxlinkUser(interaction.guild.id, interaction.user.id);
        } catch {
            robloxInfo = {
                ...pendingRobloxInfo,
                message: 'Bloxlink verification is temporarily unavailable.',
            };
        }
        const enrichedTicket = await updateTicket(pendingId, { robloxInfo: { ...robloxInfo } });
        if (!enrichedTicket) throw new Error('The reserved ticket could not be enriched with verification data.');
        reservedTicket = enrichedTicket;

        const categoryChannel = await interaction.guild.channels.fetch(definition.categoryId).catch(() => null);
        if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
            throw new Error(`The ${definition.label} category is unavailable.`);
        }
        const supportRole = await interaction.guild.roles.fetch(definition.supportRoleId).catch(() => null);
        if (!supportRole) throw new Error(`The configured ${definition.label} role is unavailable.`);
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        const channelName = `ticket-${reservedTicket.number}-${sanitizeChannelName(interaction.user.username)}`.slice(0, 100);
        channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: definition.categoryId,
            topic: `LARP ticket #${reservedTicket.number} | ${definition.label} | Creator ${interaction.user.id}`,
            reason: `Ticket #${reservedTicket.number} opened by ${interaction.user.tag}`,
            permissionOverwrites: [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
                { id: definition.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] },
                { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            ],
        });

        const active = await activateTicket(pendingId, channel.id);
        if (!active) throw new Error('The ticket record could not be activated.');
        const controlsMessage = await channel.send({
            content: '**Ticket Controls**',
            components: ticketControlRows(active),
            allowedMentions: { parse: [] },
        });
        active.controlsMessageId = controlsMessage.id;
        await updateTicket(channel.id, { controlsMessageId: controlsMessage.id });

        const openingEmbeds = buildOpeningEmbeds(active, interaction.user.displayAvatarURL({ size: 256 }));
        const openingMessage = await channel.send({
            content: `<@${interaction.user.id}> <@&${definition.supportRoleId}>`,
            embeds: [openingEmbeds[0]],
            allowedMentions: { users: [interaction.user.id], roles: [definition.supportRoleId] },
        });
        await setOpeningMessage(channel.id, openingMessage.id);
        for (const overflowEmbed of openingEmbeds.slice(1)) {
            await channel.send({ embeds: [overflowEmbed] });
        }
        await channel.send({
            content: '👋 Hello! I’m the automated LARP support assistant. I can help collect information before staff assists you.\n\nPlease explain your question or issue. If I am unsure, I will ask you to wait for a staff member.',
            allowedMentions: { parse: [] },
        });
        await sendTicketCreationLog(active, channel);
        await interaction.editReply(`Your ${definition.label} ticket is ready: ${channel}`);
    } catch (error) {
        await releaseTicketReservation(pendingId).catch(() => undefined);
        if (channel) await removeTicketRecord(channel.id).catch(() => undefined);
        if (channel) await channel.delete('Rolling back failed ticket creation').catch(() => undefined);
        throw error;
    }
}

async function requireTicket(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    allowClosed = false,
): Promise<TicketRecord | null> {
    const channelId = interaction.channelId;
    if (!channelId) {
        if (interaction.deferred || interaction.replied) await interaction.editReply('This action must be used in a server ticket channel.');
        else await interaction.reply({ content: 'This action must be used in a server ticket channel.', ephemeral: true });
        return null;
    }
    const ticket = await safelyGetTicketByChannel(channelId);
    if (!ticket) {
        if (interaction.deferred || interaction.replied) await interaction.editReply('This is not an active ticket channel.');
        else await interaction.reply({ content: 'This is not an active ticket channel.', ephemeral: true });
        return null;
    }
    if (!allowClosed && ticket.status !== 'open') {
        if (interaction.deferred || interaction.replied) await interaction.editReply('This ticket channel is no longer active.');
        else await interaction.reply({ content: 'This ticket channel is no longer active.', ephemeral: true });
        return null;
    }
    return ticket;
}

async function updateOpeningClaim(channel: TextChannel, ticket: TicketRecord): Promise<void> {
    if (!ticket.openingMessageId) return;
    const message = await channel.messages.fetch(ticket.openingMessageId).catch(() => null);
    if (!message?.embeds[0]) return;
    const embed = EmbedBuilder.from(message.embeds[0]);
    const fields = message.embeds[0].fields.map(field => field.name === 'Claimed By'
        ? { name: field.name, value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Not Claimed', inline: field.inline }
        : { name: field.name, value: field.value, inline: field.inline });
    embed.setFields(fields);
    // Claiming only updates the embed, never uploads another logo attachment
    await message.edit({ embeds: [embed] });
}

async function updateControlMessage(channel: TextChannel, ticket: TicketRecord, disabled = false): Promise<void> {
    if (!ticket.controlsMessageId) return;
    const message = await channel.messages.fetch(ticket.controlsMessageId).catch(() => null);
    if (!message) return;
    await message.edit({ content: '**Ticket Controls**', components: ticketControlRows(ticket, disabled) });
}

async function claimTicket(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the assigned support team or an administrator may claim this ticket.');
        return;
    }
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
        await interaction.editReply(`This ticket is already claimed by <@${ticket.claimedBy}>.`);
        return;
    }
    const updated = await claimOpenTicket(interaction.channelId, interaction.user.id);
    if (!updated) {
        const current = await getTicketByChannel(interaction.channelId);
        await interaction.editReply(current?.claimedBy
            ? `This ticket was just claimed by <@${current.claimedBy}>.`
            : 'Unable to claim this ticket right now.');
        return;
    }
    await updateOpeningClaim(interaction.channel, updated);
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send(`${interaction.user} claimed this ticket.\nThe automated assistant has been paused.`);
    await interaction.editReply('Ticket claimed. AI assistance has been disabled.');
}

async function unclaimTicket(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket) || (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !member?.permissions.has(PermissionFlagsBits.Administrator))) {
        await interaction.editReply('Only the claimant or an administrator may unclaim this ticket.');
        return;
    }
    const updated = await updateTicket(interaction.channelId, { claimedBy: null });
    if (!updated) throw new Error('Unable to update the ticket claim.');
    await updateOpeningClaim(interaction.channel, updated);
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send(`${interaction.user} unclaimed this ticket. AI remains disabled until staff explicitly enables it.`);
    await interaction.editReply('Ticket unclaimed.');
}

export interface TicketTranscriptFile {
    attachment: AttachmentBuilder;
    messageCount: number;
}

export async function buildTicketTranscriptFile(channel: TextChannel, ticket: TicketRecord): Promise<TicketTranscriptFile> {
    const messages: Message[] = [];
    let before: string | undefined;
    while (messages.length < 1_000) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (!batch.size) break;
        messages.push(...batch.values());
        before = batch.last()?.id;
        if (batch.size < 100) break;
    }
    messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
    const lines = messages.map(message => {
        const timestamp = message.createdAt.toISOString();
        const attachments = [...message.attachments.values()].map(item => item.url);
        const embedSummaries = message.embeds.flatMap(embed => {
            const fields = embed.fields.map(field => `${field.name}: ${field.value}`);
            const summary = [embed.title, embed.description, ...fields].filter(Boolean).join(' | ');
            return summary ? [`[Embed] ${summary}`] : [];
        });
        const body = [message.content, ...embedSummaries, ...attachments]
            .filter(Boolean)
            .join(' ')
            || '[No text content]';
        return `[${timestamp}] ${message.author.tag} (${message.author.id}): ${body}`;
    });
    const header = [
        `Los Angeles Roleplay — Ticket #${ticket.number}`,
        `Channel: ${channel.name} (${channel.id})`,
        `Creator: ${ticket.creatorId}`,
        `Generated: ${new Date().toISOString()}`,
        '',
        '',
    ].join('\n');
    return {
        attachment: new AttachmentBuilder(Buffer.from(`${header}${lines.join('\n')}`, 'utf8'), {
            name: `ticket-${ticket.number}-transcript.txt`,
        }),
        messageCount: messages.length,
    };
}

async function archiveTicketTranscript(
    interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
    ticket: TicketRecord,
    reason: string,
    transcript: TicketTranscriptFile,
): Promise<void> {
    const archiveChannel = await interaction.client.channels.fetch(CHANNEL_IDS.ticketTranscript).catch(() => null);
    if (!archiveChannel?.isSendable() || !('guildId' in archiveChannel) || archiveChannel.guildId !== ticket.guildId) {
        throw new Error(`Ticket transcript channel ${CHANNEL_IDS.ticketTranscript} is unavailable.`);
    }

    const reasonFields = splitText(reason).map((chunk, index) => ({
        name: index === 0 ? 'Closure Reason' : `Closure Reason (continued ${index + 1})`,
        value: chunk,
    }));
    const archiveEmbed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`Ticket #${ticket.number} — Archived Transcript`)
        .setDescription('A complete text transcript was archived automatically before this ticket was closed.')
        .addFields(
            { name: 'Ticket Creator', value: `<@${ticket.creatorId}>`, inline: true },
            { name: 'Closed By', value: `${interaction.user} (${interaction.user.id})`, inline: true },
            { name: 'Source Ticket', value: `<#${ticket.channelId}>`, inline: true },
            { name: 'Messages Captured', value: String(transcript.messageCount), inline: true },
            ...reasonFields,
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    await archiveChannel.send({
        embeds: [archiveEmbed],
        files: [transcript.attachment],
        allowedMentions: { parse: [] },
    });
}

async function closeTicket(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, reason = 'No reason supplied'): Promise<void> {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (interaction.user.id !== ticket.creatorId && !isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the ticket creator, assigned support team, or an administrator may close this ticket.');
        return;
    }
    const normalizedReason = reason.trim() || 'No reason supplied';
    const closeReasonChunks = splitText(normalizedReason);
    const closeEmbed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`Ticket #${ticket.number} — Closure Request`)
        .setDescription('This ticket is being closed and a complete transcript will be preserved for staff records.')
        .addFields(
            { name: 'Requested By', value: `${interaction.user}`, inline: true },
            { name: 'Ticket Creator', value: `<@${ticket.creatorId}>`, inline: true },
            { name: 'Reason', value: closeReasonChunks[0] },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    await interaction.channel.send({
        content: `<@${ticket.creatorId}>, this ticket is being closed for the reason shown below.`,
        embeds: [closeEmbed],
        allowedMentions: { users: [ticket.creatorId] },
    });
    for (const [index, chunk] of closeReasonChunks.slice(1).entries()) {
        const continuation = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle(`Ticket #${ticket.number} — Closure Reason Continued`)
            .addFields({ name: `Reason (continued ${index + 2})`, value: chunk })
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        await interaction.channel.send({
            embeds: [continuation],
            allowedMentions: { parse: [] },
        });
    }

    let transcript: TicketTranscriptFile;
    try {
        transcript = await buildTicketTranscriptFile(interaction.channel, ticket);
        await archiveTicketTranscript(interaction, ticket, normalizedReason, transcript);
    } catch (error) {
        logger.warn(`Ticket #${ticket.number} closure paused because transcript archival failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await interaction.channel.send({
            content: '⚠️ The closure was paused because the transcript could not be archived. This ticket remains open; please ask an administrator to verify the transcript channel and try again.',
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
        await interaction.editReply('The ticket remains open because its transcript could not be archived. Please verify the transcript channel and try again.');
        return;
    }

    const updated = await updateTicket(interaction.channel.id, {
        status: 'closed',
        aiEnabled: false,
        closeReason: normalizedReason,
        closedAt: new Date(),
    });
    if (!updated) throw new Error('Unable to close the ticket record.');
    await updateControlMessage(interaction.channel, updated, true);
    await interaction.channel.permissionOverwrites.edit(ticket.creatorId, { SendMessages: false }).catch(() => undefined);
    for (const userId of ticket.addedUserIds) {
        await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => undefined);
    }
    if (!interaction.channel.name.startsWith('closed-')) {
        await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100), `Ticket #${ticket.number} closed`).catch(() => undefined);
    }
    await interaction.channel.send({
        content: `🔒 Ticket #${ticket.number} has been closed by ${interaction.user}. Its transcript was archived in <#${CHANNEL_IDS.ticketTranscript}>.`,
        allowedMentions: { parse: [] },
    });
    await interaction.channel.delete(`Ticket #${ticket.number} closed`).catch(error => {
        logger.warn(`Ticket #${ticket.number} channel deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    await interaction.editReply(`This ticket has been closed, archived, and deleted.`);
}

function controlModal(action: 'close_reason' | 'add_user' | 'remove_user' | 'rename'): ModalBuilder {
    const definitions = {
        close_reason: { title: 'Close Ticket With Reason', id: 'reason', label: 'Reason for closing', style: TextInputStyle.Paragraph, max: 4000 },
        add_user: { title: 'Add User to Ticket', id: 'user', label: 'Discord user ID or mention', style: TextInputStyle.Short, max: 30 },
        remove_user: { title: 'Remove User from Ticket', id: 'user', label: 'Discord user ID or mention', style: TextInputStyle.Short, max: 30 },
        rename: { title: 'Rename Ticket', id: 'name', label: 'New channel name', style: TextInputStyle.Short, max: 80 },
    } as const;
    const definition = definitions[action];
    return new ModalBuilder()
        .setCustomId(`ticket:modal:${action}`)
        .setTitle(definition.title)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId(definition.id).setLabel(definition.label).setStyle(definition.style).setMaxLength(definition.max).setRequired(true),
        ));
}

function parseUserId(value: string): string | null {
    return value.match(/\d{17,20}/)?.[0] || null;
}

async function modifyTicketUser(interaction: ModalSubmitInteraction, adding: boolean): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel) || !interaction.guild) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the assigned support team or an administrator may change ticket access.');
        return;
    }
    const userId = parseUserId(interaction.fields.getTextInputValue('user'));
    if (!userId) {
        await interaction.editReply('Enter a valid Discord user ID or mention.');
        return;
    }
    const target = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!target) {
        await interaction.editReply('That user is not in this server.');
        return;
    }
    if (!adding && userId === ticket.creatorId) {
        await interaction.editReply('The ticket creator cannot be removed. Close the ticket instead.');
        return;
    }
    const nextUsers = adding
        ? [...new Set([...ticket.addedUserIds, userId])]
        : ticket.addedUserIds.filter(id => id !== userId);
    if (adding) {
        await interaction.channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
        });
    } else {
        await interaction.channel.permissionOverwrites.delete(userId, `Removed from ticket #${ticket.number}`).catch(() => undefined);
    }
    await updateTicket(interaction.channel.id, { addedUserIds: nextUsers });
    await interaction.channel.send(`${target} was ${adding ? 'added to' : 'removed from'} this ticket by ${interaction.user}.`);
    await interaction.editReply(`${target.user.tag} was ${adding ? 'added' : 'removed'}.`);
}

async function renameTicketFromModal(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the assigned support team or an administrator may rename this ticket.');
        return;
    }
    const newName = sanitizeChannelName(interaction.fields.getTextInputValue('name'));
    await interaction.channel.setName(newName, `Ticket #${ticket.number} renamed by ${interaction.user.tag}`);
    await interaction.channel.send(`This ticket was renamed to **${newName}** by ${interaction.user}.`);
    await interaction.editReply(`Ticket renamed to ${newName}.`);
}

async function createTranscript(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction, true);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (interaction.user.id !== ticket.creatorId && !isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the ticket creator or support staff may export this transcript.');
        return;
    }
    const transcript = await buildTicketTranscriptFile(interaction.channel, ticket);
    await interaction.editReply({
        content: `Transcript generated with ${transcript.messageCount} messages.`,
        files: [transcript.attachment],
    });
}

async function refreshRobloxInfo(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (interaction.user.id !== ticket.creatorId && !isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the ticket creator or support staff may refresh this information.');
        return;
    }
    const result = await lookupBloxlinkUser(ticket.guildId, ticket.creatorId);
    const savedResult = mergeRobloxRefreshResult(ticket.robloxInfo, result);
    const updated = await updateTicket(interaction.channelId, { robloxInfo: { ...savedResult } });
    if (!updated) throw new Error('Unable to save refreshed Roblox information.');
    if (ticket.openingMessageId) {
        const message = await interaction.channel.messages.fetch(ticket.openingMessageId).catch(() => null);
        if (message?.embeds[0]) {
            const embed = EmbedBuilder.from(message.embeds[0]);
            const fields = message.embeds[0].fields.map(field => field.name === 'Roblox Information'
                ? { name: field.name, value: robloxInfoValue(savedResult), inline: field.inline }
                : { name: field.name, value: field.value, inline: field.inline });
            embed.setFields(fields).setThumbnail(savedResult.status === 'verified' && savedResult.robloxAvatarUrl
                ? savedResult.robloxAvatarUrl
                : String(ticket.discordInfo?.avatarUrl || interaction.user.displayAvatarURL({ size: 256 })));
            await message.edit({ embeds: [embed] });
        }
    }
    await updateControlMessage(interaction.channel, updated);
    if (result.status === 'service_unavailable') {
        await interaction.editReply(savedResult.status === 'verified'
            ? 'Bloxlink is temporarily unavailable. The previously verified Roblox information was preserved.'
            : `${result.message} The ticket remains open.`);
    } else if (result.status === 'verified') {
        await interaction.editReply(`Roblox information refreshed for **${result.robloxUsername || `ID ${result.robloxId}`}**.`);
    } else {
        await interaction.editReply('No verified Roblox account was found. The ticket remains open.');
    }
}

async function escalateTicket(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const updated = await updateTicket(interaction.channelId, { escalated: true, aiEnabled: false });
    if (!updated) throw new Error('Unable to escalate the ticket.');
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send({
        content: `<@&${ticket.supportRoleId}> ${interaction.user} has requested human staff assistance. The automated assistant has been paused.`,
        allowedMentions: { roles: [ticket.supportRoleId], users: [interaction.user.id] },
    });
    await interaction.editReply('Human staff have been requested.');
}

async function toggleTicketAi(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only support staff may enable or disable the automated assistant.');
        return;
    }
    const aiEnabled = !ticket.aiEnabled;
    if (aiEnabled && ticket.claimedBy) {
        await interaction.editReply('AI cannot be enabled while this ticket is claimed. Unclaim it first.');
        return;
    }
    const updated = await updateTicket(interaction.channelId, { aiEnabled, escalated: aiEnabled ? false : ticket.escalated });
    if (!updated) throw new Error('Unable to update AI assistance.');
    await interaction.channel.send(`The automated assistant has been ${aiEnabled ? 'enabled' : 'paused'} by ${interaction.user}.`);
    await updateControlMessage(interaction.channel, updated);
    await interaction.editReply(`AI assistance ${aiEnabled ? 'enabled' : 'disabled'}.`);
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ticket:')) return false;
    if (interaction.customId.startsWith('ticket:open:')) {
        const category = interaction.customId.split(':')[2];
        if (!isTicketCategory(category)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', ephemeral: true });
            return true;
        }
        await interaction.showModal(ticketOpeningModal(category));
        return true;
    }
    if (!interaction.customId.startsWith('ticket:control:')) return false;
    const action = interaction.customId.split(':')[2];
    if (['close_reason', 'add_user', 'remove_user', 'rename'].includes(action)) {
        await interaction.showModal(controlModal(action as 'close_reason' | 'add_user' | 'remove_user' | 'rename'));
        return true;
    }
    switch (action) {
        case 'claim': await claimTicket(interaction); break;
        case 'unclaim': await unclaimTicket(interaction); break;
        case 'close': await closeTicket(interaction); break;
        case 'transcript': await createTranscript(interaction); break;
        case 'escalate': await escalateTicket(interaction); break;
        case 'toggle_ai': await toggleTicketAi(interaction); break;
        case 'refresh_roblox': await refreshRobloxInfo(interaction); break;
        default: await interaction.reply({ content: 'That ticket control is unavailable.', ephemeral: true });
    }
    return true;
}

export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId.startsWith('ticket:create:')) {
        const category = interaction.customId.split(':')[2];
        if (!isTicketCategory(category)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', ephemeral: true });
            return true;
        }
        await createTicketFromModal(interaction, category);
        return true;
    }
    if (!interaction.customId.startsWith('ticket:modal:')) return false;
    const action = interaction.customId.split(':')[2];
    switch (action) {
        case 'close_reason': await closeTicket(interaction, interaction.fields.getTextInputValue('reason')); break;
        case 'add_user': await modifyTicketUser(interaction, true); break;
        case 'remove_user': await modifyTicketUser(interaction, false); break;
        case 'rename': await renameTicketFromModal(interaction); break;
        default: return false;
    }
    return true;
}

async function directAddRemove(interaction: ChatInputCommandInteraction, adding: boolean): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only the assigned support team or an administrator may change ticket access.');
        return;
    }
    const user = interaction.options.getUser('user', true);
    if (!adding && user.id === ticket.creatorId) {
        await interaction.editReply('The ticket creator cannot be removed.');
        return;
    }
    const nextUsers = adding ? [...new Set([...ticket.addedUserIds, user.id])] : ticket.addedUserIds.filter(id => id !== user.id);
    if (adding) await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    else await interaction.channel.permissionOverwrites.delete(user.id).catch(() => undefined);
    await updateTicket(interaction.channelId, { addedUserIds: nextUsers });
    await interaction.editReply(`${user.tag} was ${adding ? 'added to' : 'removed from'} this ticket.`);
}

async function directRename(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only support staff may rename tickets.');
        return;
    }
    const name = sanitizeChannelName(interaction.options.getString('name', true));
    await interaction.channel.setName(name);
    await interaction.editReply(`Ticket renamed to ${name}.`);
}

async function transferTicket(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const ticketChannel = interaction.channel;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only support staff may transfer ticket ownership.');
        return;
    }
    const newOwner = interaction.options.getUser('new_owner', true);
    if (newOwner.id === ticket.creatorId) {
        await interaction.editReply(`${newOwner.tag} already owns this ticket.`);
        return;
    }
    if (!interaction.guild || !(await interaction.guild.members.fetch(newOwner.id).catch(() => null))) {
        await interaction.editReply('The new ticket owner must be a member of this server.');
        return;
    }
    const newOwnerWasAdded = ticket.addedUserIds.includes(newOwner.id);
    const removeNewOwnerOverwrite = async () => {
        if (!newOwnerWasAdded) await ticketChannel.permissionOverwrites.delete(newOwner.id).catch(() => undefined);
    };
    let databasePointsToNewOwner = false;
    await ticketChannel.permissionOverwrites.edit(newOwner.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    try {
        const updated = await updateTicket(interaction.channelId, {
            creatorId: newOwner.id,
            addedUserIds: ticket.addedUserIds.filter(userId => userId !== newOwner.id && userId !== ticket.creatorId),
        });
        if (!updated) throw new Error('Unable to transfer ticket ownership.');
        databasePointsToNewOwner = true;

        try {
            await ticketChannel.permissionOverwrites.delete(ticket.creatorId, `Ticket #${ticket.number} transferred to ${newOwner.tag}`);
        } catch (error) {
            const rolledBack = await updateTicket(interaction.channelId, {
                creatorId: ticket.creatorId,
                addedUserIds: ticket.addedUserIds,
            }).catch(() => null);
            databasePointsToNewOwner = !rolledBack;
            throw error;
        }
    } catch (error) {
        // If database rollback failed, keep the new owner's channel access aligned with
        // the durable creator record rather than leaving the recorded owner locked out.
        if (!databasePointsToNewOwner) await removeNewOwnerOverwrite();
        throw error;
    }
    await interaction.editReply(`Ticket ownership transferred to ${newOwner.tag}.`);
}

async function reopenTicket(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const ticket = await requireTicket(interaction, true);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket)) {
        await interaction.editReply('Only support staff may reopen tickets.');
        return;
    }
    const updated = await updateTicket(interaction.channelId, { status: 'open', closedAt: undefined, closeReason: undefined });
    if (!updated) throw new Error('Unable to reopen the ticket.');
    await interaction.channel.permissionOverwrites.edit(ticket.creatorId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true });
    await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, '')).catch(() => undefined);
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send(`Ticket #${ticket.number} was reopened by ${interaction.user}.`);
    await interaction.editReply('Ticket reopened.');
}

export async function executeTicketSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.commandName) {
        case 'ticket-panel':
        case 'ticket-message': await postTicketPanel(interaction); return;
        case 'ticket':
            if (interaction.options.getSubcommand() === 'refresh-user') await refreshRobloxInfo(interaction);
            return;
        case 'ticket-add': await directAddRemove(interaction, true); return;
        case 'ticket-remove': await directAddRemove(interaction, false); return;
        case 'ticket-close': await closeTicket(interaction); return;
        case 'ticket-claim': await claimTicket(interaction); return;
        case 'ticket-rename': await directRename(interaction); return;
        case 'ticket-transfer': await transferTicket(interaction); return;
        case 'ticket-reopen': await reopenTicket(interaction); return;
        case 'ticket-closerequest': await interaction.showModal(controlModal('close_reason')); return;
        case 'ticket-switchpanel':
        case 'ticket-edit':
        case 'ticket-notes':
            await interaction.reply({ content: 'Use the persistent controls in the ticket channel for this action.', ephemeral: true });
            return;
        default: throw new Error(`Unsupported ticket command: ${interaction.commandName}`);
    }
}

export const ticketCommands = {
    ticketMessage: executeTicketSlashCommand,
    ticketAdd: executeTicketSlashCommand,
    ticketClose: executeTicketSlashCommand,
    ticketClaim: executeTicketSlashCommand,
    ticketRemove: executeTicketSlashCommand,
    ticketRename: executeTicketSlashCommand,
    ticketTransfer: executeTicketSlashCommand,
    ticketReopen: executeTicketSlashCommand,
    ticketSwitchPanel: executeTicketSlashCommand,
    ticketNotes: executeTicketSlashCommand,
    ticketEdit: executeTicketSlashCommand,
    ticketCloseRequest: executeTicketSlashCommand,
};

export const ticketCommandDefinitions = [
    { data: new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the LARP Help & Support ticket panel'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket').setDescription('Ticket utilities').addSubcommand(command => command.setName('refresh-user').setDescription('Refresh the ticket creator’s Bloxlink and Roblox information')), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-message').setDescription('Legacy alias: post the ticket panel'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-add').setDescription('Add a user to this ticket').addUserOption(option => option.setName('user').setDescription('User to add').setRequired(true)), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current ticket'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-claim').setDescription('Claim the current ticket'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove a user from this ticket').addUserOption(option => option.setName('user').setDescription('User to remove').setRequired(true)), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-rename').setDescription('Rename the current ticket').addStringOption(option => option.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(80)), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-transfer').setDescription('Transfer ticket ownership').addUserOption(option => option.setName('new_owner').setDescription('New ticket owner').setRequired(true)), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-reopen').setDescription('Reopen the current ticket'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-switchpanel').setDescription('Legacy ticket panel control'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-notes').setDescription('Open ticket notes from the channel controls'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-edit').setDescription('Edit ticket settings from the channel controls'), execute: executeTicketSlashCommand },
    { data: new SlashCommandBuilder().setName('ticket-closerequest').setDescription('Close this ticket with a reason'), execute: executeTicketSlashCommand },
];

export function isTicketAssistantActiveForAuthor(ticket: TicketRecord, authorId: string): boolean {
    return ticket.status === 'open'
        && ticket.creatorId === authorId
        && !ticket.claimedBy
        && ticket.aiEnabled
        && !ticket.escalated;
}

export async function getOpenTicketForMessage(message: Message): Promise<TicketRecord | null> {
    if (!message.guild || message.author.bot || message.webhookId) return null;
    const ticket = await getTicketByChannel(message.channelId);
    if (!ticket || !isTicketAssistantActiveForAuthor(ticket, message.author.id)) return null;
    return ticket;
}

const aiUnavailableNotified = new Set<string>();
const aiChannelQueues = new Map<string, Promise<void>>();

async function processTicketAssistantMessage(message: Message): Promise<void> {
    const ticket = await getOpenTicketForMessage(message);
    if (!ticket || !message.channel.isSendable() || !message.content.trim()) return;

    await message.channel.sendTyping().catch(() => undefined);
    const recentMessages = await message.channel.messages.fetch({ limit: 12, before: message.id }).catch(() => null);
    const conversation = recentMessages
        ? [...recentMessages.values()]
            .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
            .flatMap((item): TicketConversationMessage[] => {
                if (item.author.id === ticket.creatorId && item.content.trim()) {
                    return [{ role: 'user' as const, content: item.content }];
                }
                if (item.author.id === message.client.user?.id && item.content.startsWith('🤖 **Automated LARP Support Assistant**')) {
                    return [{ role: 'assistant' as const, content: item.content.replace(/^🤖 \*\*Automated LARP Support Assistant\*\*\s*/u, '') }];
                }
                return [];
            })
        : [];
    const result = await generateTicketAssistantReply({
        userMessage: message.content,
        category: ticketCategories[ticket.category].label,
        ticketReason: ticket.answers.reason || ticket.answers.reportReason,
        userDisplayName: message.author.globalName || message.author.username,
        endUserId: message.author.id,
        conversation,
        eligibility: {
            isOpen: ticket.status === 'open',
            isTicketCreator: message.author.id === ticket.creatorId,
            authorIsBot: message.author.bot,
            isClaimed: Boolean(ticket.claimedBy),
            aiEnabled: ticket.aiEnabled,
            escalated: ticket.escalated,
        },
    });

    const current = await getTicketByChannel(message.channelId);
    if (!current || !isTicketAssistantActiveForAuthor(current, message.author.id)) return;
    if (result.status === 'ok') {
        aiUnavailableNotified.delete(message.channelId);
        await message.channel.send({ content: result.reply, allowedMentions: { parse: [] } });
        return;
    }
    if (result.status === 'unavailable' && !aiUnavailableNotified.has(message.channelId)) {
        aiUnavailableNotified.add(message.channelId);
        await message.channel.send({
            content: `🤖 **Automated LARP Support Assistant**\n${result.message}`,
            allowedMentions: { parse: [] },
        });
    }
}

export async function handleTicketAssistantMessage(message: Message): Promise<void> {
    const previous = aiChannelQueues.get(message.channelId) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(() => processTicketAssistantMessage(message));
    aiChannelQueues.set(message.channelId, queued);
    try {
        await queued;
    } finally {
        if (aiChannelQueues.get(message.channelId) === queued) aiChannelQueues.delete(message.channelId);
    }
}
