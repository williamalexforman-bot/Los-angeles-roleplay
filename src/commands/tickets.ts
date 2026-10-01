import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    EmbedBuilder,
    Guild,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    type OverwriteResolvable,
    parseEmoji,
} from 'discord.js';
import { BRAND, CHANNEL_IDS, TICKET_CATEGORY_IDS, TICKET_STAFF_ROLE_ID, type TicketCategory } from '../config/constants';
import { type TicketRecord } from '../database/models';
import { createLogoAttachment } from '../utils/embeds';
import { bannerFiles, bannerUrl, underbannerEmbed } from '../utils/bannerAssets';
import { logger } from '../utils/logger';
import { lookupBloxlinkUser, type BloxlinkLookupResult } from '../services/bloxlinkService';
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
import { applyTemplate, configuredChannelId, getGuildBotConfig, getPanelBannerUrl, getPanelConfig, parseEmojiMap, type ConfigChannelKey, type PanelConfig } from '../services/panelConfig';
import { embedsToV2 } from '../utils/componentsV2';

const PANEL_DESCRIPTION = `Welcome to California State Roleplay support system!

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

const TICKET_PANEL_EMOJIS = {
    title: '<:support:1525234150045519982>',
    general: '<:general:1516784296340230194>',
    management: '<:management:1553956417273340045>',
    highrank: '<:highrank:1553956417273340045>',
} as const;
const TICKET_OPENED_EMOJI = '<:support:1525234150045519982>';
const TICKET_THANKS_EMOJI = '<:ticketthanks:1525234122568765710>';
const REQUESTED_TICKET_OPENING = `## ${TICKET_THANKS_EMOJI} Thanks {opener} for contacting support!

Thank you for opening a ticket in **California State Roleplay**. {staff} will help you shortly. While you wait, please do not ping staff. Responses may take up to an hour. If you have not received an answer within **12 hours**, you may ping a staff member. If you are reporting someone, include the user’s **ID**, **screenshots**, and a clear explanation below.

**Ticket Information**
› **Opener:** {opener}
› **Ticket ID:** \`{ticket_id}\`
› **Inquiry:** {inquiry}`;

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
        get categoryId() { return TICKET_CATEGORY_IDS.general; },
        get supportRoleId() { return TICKET_STAFF_ROLE_ID; },
    },
    internal: {
        key: 'internal',
        label: 'Internal Affairs',
        title: '📋 Internal Affairs Support',
        emoji: '📋',
        menuDescription: 'Staff reports, applications, and partnerships',
        get categoryId() { return TICKET_CATEGORY_IDS.internal; },
        get supportRoleId() { return TICKET_STAFF_ROLE_ID; },
    },
    management: {
        key: 'management',
        label: 'Management',
        title: '🏛️ Management Support',
        emoji: '🏛️',
        menuDescription: 'Claims, advertisements, transfers, and staff matters',
        get categoryId() { return TICKET_CATEGORY_IDS.management; },
        get supportRoleId() { return TICKET_STAFF_ROLE_ID; },
    },
    highrank: {
        key: 'highrank',
        label: 'High-Rank',
        title: '⭐ High-Rank Support',
        emoji: '⭐',
        menuDescription: 'Payments, marketplace concerns, and ownership questions',
        get categoryId() { return TICKET_CATEGORY_IDS.highrank; },
        get supportRoleId() { return TICKET_STAFF_ROLE_ID; },
    },
};

type SupportTicketCategory = Exclude<TicketCategory, 'internal'>;
const ticketCategoryKeys = (Object.keys(ticketCategories) as TicketCategory[])
    .filter((key): key is SupportTicketCategory => key !== 'internal');

function isTicketCategory(value: string): value is SupportTicketCategory {
    return ticketCategoryKeys.includes(value as SupportTicketCategory);
}

function panelDropdown(config?: PanelConfig): ActionRowBuilder<StringSelectMenuBuilder> {
    const emojis = { ...TICKET_PANEL_EMOJIS, ...parseEmojiMap(config?.emojiText) };
    const options = ticketCategoryKeys.map(key => {
        const definition = ticketCategories[key];
        const configuredEmoji = emojis[key];
        const customEmoji = configuredEmoji ? parseEmoji(configuredEmoji) : null;
        const option = new StringSelectMenuOptionBuilder()
            .setLabel(customEmoji?.id ? definition.label : `${definition.emoji} ${definition.label}`)
            .setValue(key)
            .setDescription(definition.menuDescription);
        // Discord rejects Unicode serialized as a Components V2 option emoji object.
        // Keep Unicode in the label and reserve the emoji field for valid custom emoji IDs.
        if (customEmoji?.id) option.setEmoji({
            id: customEmoji.id,
            name: customEmoji.name || undefined,
            animated: customEmoji.animated,
        });
        return option;
    });
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('Select a support department')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options),
    );
}

function ticketPanelV2(config: PanelConfig, customBannerUrl?: string | null): ContainerBuilder {
    const emojis = { ...TICKET_PANEL_EMOJIS, ...parseEmojiMap(config.emojiText) };
    const status = new ButtonBuilder()
        .setCustomId('ticket:panel:status')
        .setLabel('Support Open')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true);
    return new ContainerBuilder()
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(customBannerUrl || bannerUrl('assistance')),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${emojis.title || '🎫'} ${config.title}`,
            config.description || PANEL_DESCRIPTION,
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Available Departments',
            `${emojis.general || '🎫'} **General Support** — Questions and server information`,
            `${emojis.management || '🏛️'} **Management Support** — Claims, transfers, and management concerns`,
            `${emojis.highrank || '⭐'} **High-Rank Support** — Payments and ownership questions`,
            '',
            '> Select the department that best matches your request. A private channel will be created for you and authorized staff.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(status))
        .addActionRowComponents(panelDropdown(config))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# California State Roleplay • Assistance Center • Please do not open duplicate tickets'))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerUrl('underbanner')),
        ));
}

/** Update an existing Assistance panel, or create one when the configured channel has none. */
export async function postOrUpdateTicketPanel(guild: Guild): Promise<'updated' | 'posted' | 'missing-channel'> {
    const channelId = await configuredChannelId(guild, 'ticket_panel', CHANNEL_IDS.ticketPanel);
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!(channel instanceof TextChannel)) return 'missing-channel';
    const config = await getPanelConfig(guild, 'ticket_panel');
    const customBannerUrl = await getPanelBannerUrl(guild, config);
    const recentMessages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existingPanels = recentMessages?.filter(message => message.author.id === guild.client.user?.id
        && (JSON.stringify(message.components.map(component => component.toJSON())).includes('ticket_select')
            || message.embeds.some(embed => ['Help & Support', 'Assistance'].includes(embed.title || ''))));
    const payload = {
        embeds: [] as never[],
        components: [ticketPanelV2(config, customBannerUrl)],
        flags: MessageFlags.IsComponentsV2 as const,
        files: [createLogoAttachment(), ...bannerFiles('assistance')],
        allowedMentions: { parse: [] as never[] },
    };
    if (existingPanels?.size) {
        for (const existing of existingPanels.values()) await existing.edit({ ...payload, attachments: [] });
        return 'updated';
    }
    await channel.send(payload);
    return 'posted';
}

/** Updates existing bot-authored panels without posting duplicates during restarts. */
export async function refreshExistingTicketPanels(client: Client): Promise<number> {
    let updated = 0;
    for (const guild of client.guilds.cache.values()) {
        const result = await postOrUpdateTicketPanel(guild).catch(() => 'missing-channel' as const);
        if (result === 'updated') updated += 1;
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
        || member.roles.cache.has(TICKET_STAFF_ROLE_ID)
        || member.roles.cache.has(ticket.supportRoleId)
        || Boolean(process.env.BOT_PERMISSIONS_ROLE_ID && member.roles.cache.has(process.env.BOT_PERMISSIONS_ROLE_ID));
}

/** Applies the universal ticket-staff role to ticket channels that already existed before this release. */
export async function refreshExistingTicketAccess(client: Client): Promise<number> {
    let updated = 0;
    for (const guild of client.guilds.cache.values()) {
        const ticketStaffRole = await guild.roles.fetch(TICKET_STAFF_ROLE_ID).catch(() => null);
        if (!ticketStaffRole) continue;
        const saved = await getGuildBotConfig(guild);
        const replacedRoleIds = new Set([
            saved.roles.general_support,
            saved.roles.management,
            process.env.GENERAL_SUPPORT_ROLE_ID,
            process.env.MANAGEMENT_ROLE_ID,
        ].filter((roleId): roleId is string => Boolean(roleId) && roleId !== TICKET_STAFF_ROLE_ID));
        const channels = await guild.channels.fetch().catch(() => null);
        if (!channels) continue;
        for (const channel of channels.values()) {
            if (!(channel instanceof TextChannel) || !channel.topic?.startsWith('CSRP ticket #')) continue;
            await channel.permissionOverwrites.edit(ticketStaffRole.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
                EmbedLinks: true,
                ManageMessages: true,
            }, { reason: 'Applied universal CSRP ticket staff access' });
            for (const roleId of replacedRoleIds) {
                await channel.permissionOverwrites.delete(roleId, 'Replaced by universal CSRP ticket staff role').catch(() => undefined);
            }
            updated += 1;
        }
    }
    return updated;
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

export function buildOpeningPanel(
    ticket: TicketRecord,
    fallbackAvatarUrl: string,
    configured: PanelConfig = {
        title: 'Support Ticket Opened',
        description: '## Thanks {opener} for contacting support!\n\nThank you for opening a ticket. Staff will assist you shortly.',
    },
    customBannerUrl?: string | null,
    controlsDisabled = false,
): ContainerBuilder {
    const category = ticketCategories[ticket.category];
    const roblox = (ticket.robloxInfo || {}) as Partial<BloxlinkLookupResult>;
    const answers = answerLabels(ticket);
    const inquiry = answers[0]?.[1] || 'No inquiry was provided.';
    const opener = `<@${ticket.creatorId}>`;
    const values = {
        opener,
        staff: ticket.supportRoleId ? `<@&${ticket.supportRoleId}>` : '**Staff Team**',
        ticket_id: `TICKET-${String(ticket.number).padStart(6, '0')}`,
        inquiry,
        category: category.label,
    };
    const configuredDescription = configured.description.includes('Thank you for opening a ticket with **California State Roleplay**.')
        ? REQUESTED_TICKET_OPENING
        : configured.description;
    void roblox;
    void fallbackAvatarUrl;
    return new ContainerBuilder()
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(customBannerUrl || bannerUrl('assistance')),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ${parseEmojiMap(configured.emojiText).title || TICKET_OPENED_EMOJI} ${applyTemplate(configured.title, values)}`,
            applyTemplate(configuredDescription, values),
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '**Ticket Status:** Waiting for staff',
            `**Department:** ${category.label}`,
            `**Opened:** <t:${Math.floor(ticket.createdAt.getTime() / 1_000)}:R>`,
            '',
            '> Use the controls below to claim, close, or escalate this ticket. Only authorized staff can perform staff actions.',
        ].join('\n')))
        .addActionRowComponents(...ticketControlRows(ticket, controlsDisabled, configured))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${BRAND.footer} • Ticket #${ticket.number}`))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerUrl('underbanner')),
        ));
}

function ticketControlRows(ticket: TicketRecord, disabled = false, config?: PanelConfig): ActionRowBuilder<ButtonBuilder>[] {
    const emojis = parseEmojiMap(config?.emojiText);
    const withEmoji = (button: ButtonBuilder, emoji: string): ButtonBuilder => {
        try { return button.setEmoji(emoji); } catch { return button; }
    };
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        withEmoji(new ButtonBuilder().setCustomId('ticket:control:claim')
            .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim').setStyle(ButtonStyle.Success)
            .setDisabled(disabled || Boolean(ticket.claimedBy)), emojis.claim || '🙋'),
        withEmoji(new ButtonBuilder().setCustomId('ticket:control:close').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(disabled), emojis.close || '🔒'),
        withEmoji(new ButtonBuilder().setCustomId('ticket:control:escalate').setLabel(ticket.escalated ? 'Escalated' : 'Escalate')
            .setStyle(ButtonStyle.Primary).setDisabled(disabled || ticket.escalated), emojis.escalate || '🚨'),
    )];
}

export async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in the CSRP server.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) return;
    const member = await fetchInteractionMember(interaction);
    if (!member || !hasPanelPermission(member)) {
        await interaction.editReply('You must be a server administrator or hold the configured bot-permissions role.');
        return;
    }

    const panelChannelId = await configuredChannelId(guild, 'ticket_panel', CHANNEL_IDS.ticketPanel);
    const configuredPanel = panelChannelId
        ? await guild.channels.fetch(panelChannelId).catch(() => null)
        : null;
    const panelChannel = configuredPanel?.isSendable()
        ? configuredPanel
        : interaction.channel?.isSendable() ? interaction.channel : null;
    if (!panelChannel?.isSendable()) {
        await interaction.editReply('I could not find a text channel where the ticket panel can be posted.');
        return;
    }

    const refreshedPanels = await refreshExistingTicketPanels(interaction.client);
    if (refreshedPanels > 0) {
        await interaction.deleteReply().catch(() => undefined);
        return;
    }

    const config = await getPanelConfig(guild, 'ticket_panel');
    const customBannerUrl = await getPanelBannerUrl(guild, config);
    await panelChannel.send({
        components: [ticketPanelV2(config, customBannerUrl)],
        files: [createLogoAttachment(), ...bannerFiles('assistance')],
        flags: MessageFlags.IsComponentsV2,
    });
    await interaction.deleteReply().catch(() => undefined);
}

export async function postTicketPanelFromMessage(message: Message): Promise<void> {
    if (!message.guild || !message.channel.isSendable()) return;
    const config = await getPanelConfig(message.guild, 'ticket_panel');
    const customBannerUrl = await getPanelBannerUrl(message.guild, config);
    const targetId = await configuredChannelId(message.guild, 'ticket_panel', CHANNEL_IDS.ticketPanel);
    const target = targetId ? await message.client.channels.fetch(targetId).catch(() => null) : null;
    const destination = target?.isSendable() ? target : message.channel;
    await destination.send({
        components: [ticketPanelV2(config, customBannerUrl)],
        files: [createLogoAttachment(), ...bannerFiles('assistance')],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
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
        const logChannel = await channel.client.channels.fetch(await configuredChannelId(channel.guild, 'command_logs', CHANNEL_IDS.discordCommandLog)).catch(() => null);
        if (!logChannel?.isSendable()) return;
        const embed = new EmbedBuilder()
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
        await logChannel.send({ components: embedsToV2([embed]), files: [createLogoAttachment()], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        logger.warn(`Ticket creation audit unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function createTicketFromModal(interaction: ModalSubmitInteraction, category: TicketCategory): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({ content: 'Tickets can only be opened inside the CSRP server.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const definition = ticketCategories[category];
    const categoryConfigKeys: Record<TicketCategory, ConfigChannelKey> = {
        general: 'general_ticket_category', internal: 'internal_ticket_category', management: 'management_ticket_category', highrank: 'highrank_ticket_category',
    };
    const configuredCategoryId = await configuredChannelId(interaction.guild, categoryConfigKeys[category], definition.categoryId);
    const configuredSupportRoleId = TICKET_STAFF_ROLE_ID;
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
        supportRoleId: configuredSupportRoleId,
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

        const categoryChannel = configuredCategoryId
            ? await interaction.guild.channels.fetch(configuredCategoryId).catch(() => null)
            : null;
        const parentId = categoryChannel?.type === ChannelType.GuildCategory ? categoryChannel.id : undefined;
        const supportRole = configuredSupportRoleId
            ? await interaction.guild.roles.fetch(configuredSupportRoleId).catch(() => null)
            : null;
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        const channelName = `ticket-${reservedTicket.number}-${sanitizeChannelName(interaction.user.username)}`.slice(0, 100);
        const permissionOverwrites: OverwriteResolvable[] = [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ];
        if (supportRole) {
            permissionOverwrites.push({
                id: supportRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages],
            });
        }
        channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: parentId,
            topic: `CSRP ticket #${reservedTicket.number} | ${definition.label} | Creator ${interaction.user.id}`,
            reason: `Ticket #${reservedTicket.number} opened by ${interaction.user.tag}`,
            permissionOverwrites,
        });

        const active = await activateTicket(pendingId, channel.id);
        if (!active) throw new Error('The ticket record could not be activated.');
        const ticketConfig = await getPanelConfig(interaction.guild, 'ticket');
        const ticketBannerUrl = await getPanelBannerUrl(interaction.guild, ticketConfig);
        const openingPanel = buildOpeningPanel(active, interaction.user.displayAvatarURL({ size: 256 }), ticketConfig, ticketBannerUrl);
        const openingMessage = await channel.send({
            components: [openingPanel],
            files: [createLogoAttachment(), ...bannerFiles('assistance')],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [interaction.user.id], roles: supportRole ? [supportRole.id] : [] },
        });
        await setOpeningMessage(channel.id, openingMessage.id);
        active.controlsMessageId = openingMessage.id;
        await updateTicket(channel.id, { controlsMessageId: openingMessage.id });
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
        else await interaction.reply({ content: 'This action must be used in a server ticket channel.', flags: MessageFlags.Ephemeral });
        return null;
    }
    const ticket = await safelyGetTicketByChannel(channelId);
    if (!ticket) {
        if (interaction.deferred || interaction.replied) await interaction.editReply('This is not an active ticket channel.');
        else await interaction.reply({ content: 'This is not an active ticket channel.', flags: MessageFlags.Ephemeral });
        return null;
    }
    if (!allowClosed && ticket.status !== 'open') {
        if (interaction.deferred || interaction.replied) await interaction.editReply('This ticket channel is no longer active.');
        else await interaction.reply({ content: 'This ticket channel is no longer active.', flags: MessageFlags.Ephemeral });
        return null;
    }
    return ticket;
}

async function updateControlMessage(channel: TextChannel, ticket: TicketRecord, disabled = false): Promise<void> {
    if (!ticket.controlsMessageId) return;
    const message = await channel.messages.fetch(ticket.controlsMessageId).catch(() => null);
    if (!message) return;
    const configured = await getPanelConfig(channel.guild, 'ticket');
    const customBannerUrl = await getPanelBannerUrl(channel.guild, configured);
    const panel = buildOpeningPanel(ticket, String(ticket.discordInfo?.avatarUrl || ''), configured, customBannerUrl, disabled);
    await message.edit({ embeds: [], components: [panel], flags: MessageFlags.IsComponentsV2 });
}

async function claimTicket(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send(`${interaction.user} claimed this ticket.`);
    await interaction.editReply('Ticket claimed successfully.');
}

async function unclaimTicket(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const member = await fetchInteractionMember(interaction);
    if (!isTicketStaff(member, ticket) || (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !member?.permissions.has(PermissionFlagsBits.Administrator))) {
        await interaction.editReply('Only the claimant or an administrator may unclaim this ticket.');
        return;
    }
    const updated = await updateTicket(interaction.channelId, { claimedBy: null });
    if (!updated) throw new Error('Unable to update the ticket claim.');
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send(`${interaction.user} unclaimed this ticket.`);
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
        `California State Roleplay — Ticket #${ticket.number}`,
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
    const archiveChannelId = await configuredChannelId(interaction.guild, 'ticket_transcripts', CHANNEL_IDS.ticketTranscript);
    const archiveChannel = await interaction.client.channels.fetch(archiveChannelId).catch(() => null);
    if (!archiveChannel?.isSendable() || !('guildId' in archiveChannel) || archiveChannel.guildId !== ticket.guildId) {
        throw new Error(`Ticket transcript channel ${CHANNEL_IDS.ticketTranscript} is unavailable.`);
    }

    const reasonFields = splitText(reason).map((chunk, index) => ({
        name: index === 0 ? 'Closure Reason' : `Closure Reason (continued ${index + 1})`,
        value: chunk,
    }));
    const archiveEmbed = new EmbedBuilder()
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
        components: embedsToV2([archiveEmbed]),
        files: [transcript.attachment],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function closeTicket(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, reason = 'No reason supplied'): Promise<void> {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
        .setTitle(`Ticket #${ticket.number} — Closure Request`)
        .setDescription(`<@${ticket.creatorId}>, this ticket is being closed and a complete transcript will be preserved for staff records.`)
        .addFields(
            { name: 'Requested By', value: `${interaction.user}`, inline: true },
            { name: 'Ticket Creator', value: `<@${ticket.creatorId}>`, inline: true },
            { name: 'Reason', value: closeReasonChunks[0] },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    await interaction.channel.send({
        components: embedsToV2([closeEmbed]),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [ticket.creatorId] },
    });
    for (const [index, chunk] of closeReasonChunks.slice(1).entries()) {
        const continuation = new EmbedBuilder()
            .setTitle(`Ticket #${ticket.number} — Closure Reason Continued`)
            .addFields({ name: `Reason (continued ${index + 2})`, value: chunk })
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        await interaction.channel.send({
            components: embedsToV2([continuation]),
            flags: MessageFlags.IsComponentsV2,
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = await requireTicket(interaction);
    if (!ticket || !(interaction.channel instanceof TextChannel)) return;
    const updated = await updateTicket(interaction.channelId, { escalated: true, aiEnabled: false });
    if (!updated) throw new Error('Unable to escalate the ticket.');
    await updateControlMessage(interaction.channel, updated);
    await interaction.channel.send({
        content: `<@&${ticket.supportRoleId}> ${interaction.user} has escalated this ticket and requested staff assistance.`,
        allowedMentions: { roles: [ticket.supportRoleId], users: [interaction.user.id] },
    });
    await interaction.editReply('Human staff have been requested.');
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ticket:')) return false;
    if (interaction.customId.startsWith('ticket:open:')) {
        const category = interaction.customId.split(':')[2];
        if (!isTicketCategory(category)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
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
        case 'refresh_roblox': await refreshRobloxInfo(interaction); break;
        default: await interaction.reply({ content: 'That ticket control is unavailable.', flags: MessageFlags.Ephemeral });
    }
    return true;
}

export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId.startsWith('ticket:create:')) {
        const category = interaction.customId.split(':')[2];
        if (!isTicketCategory(category)) {
            await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
            await interaction.reply({ content: 'Use the persistent controls in the ticket channel for this action.', flags: MessageFlags.Ephemeral });
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
    { data: new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the CSRP Assistance ticket panel'), execute: executeTicketSlashCommand },
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
