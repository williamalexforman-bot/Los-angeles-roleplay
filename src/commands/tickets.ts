import { resolve } from 'path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type GuildMember,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { resolveDockRobloxProfile } from '../services/dockService';
import { logger } from '../utils/logger';
import {
    closeTicketWithLifecycle,
    handleTicketFeedbackButton,
    handleTicketFeedbackModal,
} from './ticketLifecycleEnhancements';
import { SUPPORT_FAQ, TICKET_TERMS } from './supportContent';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const INTERNAL_AFFAIRS_ROLE_ID = '1521593407816990811';
const MANAGEMENT_ROLE_ID = '1521593407741362259';
const HIGH_RANK_ROLE_ID = '1521593407804280970';
const TICKET_PANEL_CHANNEL_ID = '1526034504953892925';

const TICKET_CATEGORIES = {
    general: { label: 'General Support', emoji: '🎫', parentId: '1526254341646712883' },
    internal: { label: 'Internal Affairs Support', emoji: '📋', parentId: '1526254402426503320' },
    management: { label: 'Management Support', emoji: '🏛️', parentId: '1526254462128099479' },
    highrank: { label: 'Directorship / Ownership', emoji: '⭐', parentId: '1526254518570844231' },
} as const;

const TICKET_CHANNEL_PREFIXES = {
    general: 'gen',
    internal: 'ia',
    management: 'mgmt',
    highrank: 'hr',
} as const;

type TicketType = keyof typeof TICKET_CATEGORIES;
type TicketAnswer = { label: string; value: string };

interface TicketMetadata {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
}

interface TicketGateState {
    userId: string;
    type: TicketType;
    timestamp: number;
    signature: string;
}

interface PendingReroute {
    userId: string;
    originalType: TicketType;
    answers: TicketAnswer[];
    expiresAt: number;
}

const TICKET_GATE_DELAY_MS = 10_000;
const TICKET_GATE_TTL_MS = 15 * 60_000;
const REROUTE_TTL_MS = 10 * 60_000;
const pendingReroutes = new Map<string, PendingReroute>();

const PANEL_COPY = [
    '## 🎫 Los Angeles Roleplay Support',
    'Welcome to the Los Angeles Roleplay support system! Select the option that best matches what you need.',
    '',
    '### 🎫 General Support',
    '> General questions • Server information • Normal assistance',
    '### 📋 Internal Affairs Support',
    '> Reports against staff or other members • Internal complaints',
    '### 🏛️ Management Support',
    '> Partnerships • Perks/prizes • Staff transfers • Fast passes • Management concerns',
    '### ⭐ Directorship / Ownership',
    '> Ownership-level concerns • Marketplace/payment issues • High-rank matters',
    '',
    '*Realism at its finest*',
].join('\n');

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function compact(value: string, max = 900): string {
    const clean = value.replace(/```/g, "'''").trim() || 'Not provided.';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function ticketRoleId(type: TicketType): string {
    if (type === 'internal') return INTERNAL_AFFAIRS_ROLE_ID;
    if (type === 'management') return MANAGEMENT_ROLE_ID;
    if (type === 'highrank') return HIGH_RANK_ROLE_ID;
    return TICKET_SUPPORT_ROLE_ID;
}

function ticketSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket:create-select')
            .setPlaceholder('Select the correct support category')
            .addOptions(
                ...Object.entries(TICKET_CATEGORIES).map(([value, category]) => ({
                    label: category.label,
                    value,
                    emoji: category.emoji,
                })),
            ),
    );
}

function buildTicketLauncher(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(PANEL_COPY))
        .addActionRowComponents(ticketSelect())
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function ticketActionRows(claimedBy?: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:claim')
                .setLabel(claimedBy ? `Claimed by ${claimedBy}`.slice(0, 80) : 'Claim')
                .setStyle(ButtonStyle.Success)
                .setDisabled(Boolean(claimedBy)),
            new ButtonBuilder()
                .setCustomId('ticket:close')
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket:escalate')
                .setLabel('Escalate')
                .setStyle(ButtonStyle.Secondary),
        ),
    ];
}

function primaryInquiry(answers: readonly TicketAnswer[]): string {
    return answers.find(answer => answer.label.toLowerCase().includes('reason'))?.value
        || answers[0]?.value
        || 'Not provided.';
}

function buildOpenTicketPanel(params: {
    userId: string;
    username: string;
    joinedAt: number | null;
    type: TicketType;
    answers: readonly TicketAnswer[];
    ticketId: string;
    createdAt: number;
    robloxId?: string | null;
    robloxName?: string | null;
}): ContainerBuilder {
    const category = TICKET_CATEGORIES[params.type];
    const roleId = ticketRoleId(params.type);
    const inquiry = compact(primaryInquiry(params.answers), 1_100);
    const extraAnswers = params.answers.filter(answer => !answer.label.toLowerCase().includes('reason'));

    const lines = [
        `<@${params.userId}> | <@&${roleId}>`,
        '',
        '## 🛟 Assistance',
        `Welcome to **Los Angeles Roleplay**. Thank you for reaching out to support. A member of the ${category.label} team will be with you shortly. Inactivity for over 12 hours may lead to closure.`,
        '',
        `**Ticket ID:** ${params.ticketId}`,
        `**Date Opened:** <t:${Math.floor(params.createdAt / 1_000)}:F> (<t:${Math.floor(params.createdAt / 1_000)}:R>)`,
        `**Member:** <@${params.userId}> | ${compact(params.username, 80)}`,
        '**Claimed By:** Unclaimed',
        `**Joined Server:** ${params.joinedAt ? `<t:${Math.floor(params.joinedAt / 1_000)}:F> (<t:${Math.floor(params.joinedAt / 1_000)}:R>)` : 'Unavailable'}`,
        '**Inquiry:**',
        inquiry,
        ...extraAnswers.flatMap(answer => [`**${answer.label}:** ${compact(answer.value, 500)}`]),
        `**Roblox Id:** ${params.robloxId || 'Unavailable'}`,
        `**Roblox Name:** ${params.robloxName || 'Unavailable'}`,
    ];

    const panel = new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 4_000)));

    for (const row of ticketActionRows()) panel.addActionRowComponents(row);
    return panel
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function buildCloseRequestPanel(ownerId: string, requesterId: string, reason: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `<@${ownerId}>`,
            '## 📝 Ticket Close Request',
            `<@${requesterId}> would like to close this ticket.`,
            '',
            '**Reason:**',
            compact(reason, 1_000),
        ].join('\n')))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('ticket:close-confirm').setLabel('Close').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket:close-keep').setLabel('Keep Open').setStyle(ButtonStyle.Secondary),
            ),
        )
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function encodeMetadata(metadata: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
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

function safeChannelName(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'member';
}

function ticketChannelName(type: TicketType, reason: string, userId: string): string {
    const detail = safeChannelName(reason).slice(0, 24) || 'support';
    return `${TICKET_CHANNEL_PREFIXES[type]}-${detail}-${userId.slice(-4)}`.slice(0, 40);
}

function memberHasRole(member: ButtonInteraction['member'] | StringSelectMenuInteraction['member'] | ModalSubmitInteraction['member'] | ChatInputCommandInteraction['member'], roleId: string): boolean {
    if (!member) return false;
    const roles = (member as GuildMember).roles;
    if (roles && 'cache' in roles) return roles.cache.has(roleId);
    return Array.isArray((member as { roles?: string[] }).roles) && (member as { roles: string[] }).roles.includes(roleId);
}

function isTicketStaff(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): boolean {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
        || memberHasRole(interaction.member, TICKET_SUPPORT_ROLE_ID)
        || memberHasRole(interaction.member, INTERNAL_AFFAIRS_ROLE_ID)
        || memberHasRole(interaction.member, MANAGEMENT_ROLE_ID)
        || memberHasRole(interaction.member, HIGH_RANK_ROLE_ID);
}

function ticketGateSignature(stage: 'choice' | 'read', guildId: string, type: TicketType, userId: string, timestamp: number): string {
    const secret = process.env.TICKET_GATE_SECRET || process.env.BOT_TOKEN || process.env.TOKEN || 'local-ticket-gate';
    return createHmac('sha256', secret)
        .update(`${stage}:${guildId}:${type}:${userId}:${timestamp}`)
        .digest('base64url')
        .slice(0, 12);
}

function newTicketGate(interaction: StringSelectMenuInteraction | ButtonInteraction, type: TicketType, stage: 'choice' | 'read'): TicketGateState {
    const timestamp = Date.now();
    return {
        userId: interaction.user.id,
        type,
        timestamp,
        signature: ticketGateSignature(stage, interaction.guildId || '', type, interaction.user.id, timestamp),
    };
}

function gateCustomId(action: 'faq' | 'tos' | 'continue', gate: TicketGateState): string {
    return `ticket:gate:${action}:${gate.type}:${gate.userId}:${gate.timestamp.toString(36)}:${gate.signature}`;
}

function ticketGateChoiceRow(gate: TicketGateState): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(gateCustomId('faq', gate)).setLabel('Frequently Asked Questions').setEmoji('❔').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(gateCustomId('tos', gate)).setLabel('Ticket TOS').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    );
}

function safeSignatureMatches(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseTicketGate(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    stage: 'choice' | 'read',
    type: string,
    userId: string,
    encodedTimestamp: string,
    signature: string,
): TicketGateState | null {
    if (!(type in TICKET_CATEGORIES) || !/^\d{17,20}$/u.test(userId)) return null;
    const ticketType = type as TicketType;
    const timestamp = Number.parseInt(encodedTimestamp, 36);
    const age = Date.now() - timestamp;
    if (!Number.isSafeInteger(timestamp) || age < -30_000 || age > TICKET_GATE_TTL_MS) return null;
    if (userId !== interaction.user.id) return null;
    const expected = ticketGateSignature(stage, interaction.guildId || '', ticketType, userId, timestamp);
    if (!safeSignatureMatches(signature, expected)) return null;
    return { type: ticketType, userId, timestamp, signature };
}

function ticketGateChoicePanel(gate: TicketGateState): ContainerBuilder {
    const category = TICKET_CATEGORIES[gate.type];
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Read Before Opening Your Ticket',
            `You selected **${category.emoji} ${category.label}**.`,
            '',
            'Before opening your ticket, please read either our **Frequently Asked Questions** or our **Ticket Terms of Service**.',
            '',
            'You must review one section for 10 seconds before you can continue.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addActionRowComponents(ticketGateChoiceRow(gate))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function ticketGateReadingPayload(gate: TicketGateState, kind: 'faq' | 'tos', unlocked: boolean) {
    return {
        content: [
            kind === 'faq' ? SUPPORT_FAQ : TICKET_TERMS,
            '',
            unlocked
                ? 'If this did not resolve your issue, you may now continue.'
                : 'Please review this information. **Still Need Assistance** will appear in 10 seconds.',
        ].join('\n'),
        components: unlocked
            ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(gateCustomId('continue', gate))
                    .setLabel('Still Need Assistance')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Danger),
            )]
            : [],
        allowedMentions: { parse: [] as [] },
    };
}

function modalInput(customId: string, label: string, style: TextInputStyle, required = true): ActionRowBuilder<TextInputBuilder> {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(style)
            .setRequired(required)
            .setMaxLength(style === TextInputStyle.Short ? 100 : 1_000),
    );
}

function createTicketModal(gate: TicketGateState): ModalBuilder {
    return createTicketModalForType(
        gate.type,
        `ticket:create-modal:${gate.type}:${gate.userId}:${gate.timestamp.toString(36)}:${gate.signature}`,
    );
}

function createTicketModalForType(type: TicketType, customId: string): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`${TICKET_CATEGORIES[type].label} Ticket`.slice(0, 45));
    if (type === 'internal') {
        return modal.addComponents(
            modalInput('reported_user', 'User you are reporting', TextInputStyle.Short),
            modalInput('reason', 'Reason for report', TextInputStyle.Paragraph),
            modalInput('proof', 'Do you have proof?', TextInputStyle.Paragraph),
            modalInput('anything_else', 'Anything else?', TextInputStyle.Paragraph, false),
        );
    }
    return modal.addComponents(modalInput('reason', 'Reason for opening ticket', TextInputStyle.Paragraph));
}

function closeRequestModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('ticket:close-request-modal')
        .setTitle('Request Ticket Closure')
        .addComponents(modalInput('reason', 'Reason for close request', TextInputStyle.Paragraph));
}

function modalAnswers(interaction: ModalSubmitInteraction, type: TicketType): TicketAnswer[] {
    if (type === 'internal') {
        return [
            { label: 'User Reported', value: interaction.fields.getTextInputValue('reported_user') },
            { label: 'Reason for Report', value: interaction.fields.getTextInputValue('reason') },
            { label: 'Proof', value: interaction.fields.getTextInputValue('proof') },
            { label: 'Anything Else', value: interaction.fields.getTextInputValue('anything_else') || 'Nothing else provided.' },
        ];
    }
    return [{ label: 'Reason for Opening Ticket', value: interaction.fields.getTextInputValue('reason') }];
}

function partnershipReason(reason: string): boolean {
    return /\b(partnership|partner(?:ship)?s?|affiliate|affiliation)\b/iu.test(reason);
}

function reportPersonReason(reason: string): boolean {
    return /\b(report(?:ing)?|complaint)\b.{0,45}\b(staff|member|user|person|moderator|admin|officer|someone|him|her|them)\b/iu.test(reason)
        || /\b(staff|member|user|person|moderator|admin|officer|someone)\b.{0,45}\b(report(?:ing)?|complaint)\b/iu.test(reason);
}

function makePendingReroute(userId: string, originalType: TicketType, answers: TicketAnswer[]): string {
    const token = randomUUID().replace(/-/g, '').slice(0, 20);
    pendingReroutes.set(token, { userId, originalType, answers, expiresAt: Date.now() + REROUTE_TTL_MS });
    return token;
}

function getPendingReroute(token: string, userId: string): PendingReroute | null {
    const pending = pendingReroutes.get(token);
    if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) {
        pendingReroutes.delete(token);
        return null;
    }
    return pending;
}

async function createTicketFromData(
    interaction: ModalSubmitInteraction | ButtonInteraction,
    type: TicketType,
    answers: TicketAnswer[],
): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const guild = interaction.guild;
    if (!guild) {
        await interaction.editReply('Tickets can only be created inside the server.');
        return;
    }

    const category = TICKET_CATEGORIES[type];
    const reason = primaryInquiry(answers);
    const metadata: TicketMetadata = {
        ownerId: interaction.user.id,
        type,
        createdAt: new Date().toISOString(),
    };
    const roleId = ticketRoleId(type);
    let channel: TextChannel | null = null;

    try {
        channel = await guild.channels.create({
            name: ticketChannelName(type, reason, interaction.user.id),
            type: ChannelType.GuildText,
            parent: category.parentId,
            topic: encodeMetadata(metadata),
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
                },
                {
                    id: TICKET_SUPPORT_ROLE_ID,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
                },
                ...(roleId === TICKET_SUPPORT_ROLE_ID ? [] : [{
                    id: roleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
                }]),
                {
                    id: interaction.client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
                },
            ],
            reason: `${category.label} ticket opened by ${interaction.user.tag}`,
        });

        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        const dock = await resolveDockRobloxProfile(guild.id, interaction.user.id).catch(() => null);
        const robloxId = dock?.ok ? dock.profile.robloxId : null;
        const robloxName = dock?.ok ? dock.profile.username : null;
        const ticketId = channel.id.slice(-6);
        const createdAt = Date.now();

        const panelMessage = await channel.send({
            components: [buildOpenTicketPanel({
                userId: interaction.user.id,
                username: interaction.user.username,
                joinedAt: member?.joinedTimestamp || null,
                type,
                answers,
                ticketId,
                createdAt,
                robloxId,
                robloxName,
            })],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: [],
                users: [interaction.user.id],
                roles: [roleId],
            },
        });

        metadata.panelMessageId = panelMessage.id;
        await channel.setTopic(encodeMetadata(metadata), `Ticket panel linked for ${interaction.user.id}`);
        await interaction.editReply(`✅ Your ${category.label} ticket has been created: <#${channel.id}>`);
    } catch (error) {
        if (channel) await channel.delete('Ticket setup failed.').catch(() => undefined);
        logger.error(`[Tickets] Could not create ticket: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Unable to create your ticket. Please contact an administrator.');
    }
}

async function routeSubmittedTicket(interaction: ModalSubmitInteraction, type: TicketType, answers: TicketAnswer[]): Promise<void> {
    const reason = primaryInquiry(answers);

    if (type !== 'internal' && reportPersonReason(reason)) {
        const token = makePendingReroute(interaction.user.id, type, answers);
        await interaction.reply({
            content: [
                '### 📋 This needs Internal Affairs',
                'Your reason looks like you are reporting a person or staff member. Reports must be opened as **Internal Affairs Support** so the correct team receives them.',
                '',
                'Press the button below to continue with the Internal Affairs report form.',
            ].join('\n'),
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket:reroute-ia:${token}`)
                    .setLabel('Open Internal Affairs Report')
                    .setStyle(ButtonStyle.Primary),
            )],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return;
    }

    if (type !== 'management' && partnershipReason(reason)) {
        const token = makePendingReroute(interaction.user.id, type, answers);
        await interaction.reply({
            content: [
                '### 🏛️ Partnership tickets are handled by Management',
                `You selected **${TICKET_CATEGORIES[type].label}**, but your reason mentions a partnership.`,
                '',
                'Choose whether you want to continue with your original ticket type or switch this request to **Management Support**.',
            ].join('\n'),
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket:reroute-original:${token}`)
                    .setLabel(`Keep ${TICKET_CATEGORIES[type].label}`.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`ticket:reroute-management:${token}`)
                    .setLabel('Switch to Management')
                    .setStyle(ButtonStyle.Primary),
            )],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return;
    }

    await createTicketFromData(interaction, type, answers);
}

async function rejectTicketGate(interaction: ButtonInteraction, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function scheduleTicketGateUnlock(interaction: ButtonInteraction, gate: TicketGateState, kind: 'faq' | 'tos'): void {
    const timeout = setTimeout(() => {
        void interaction.editReply(ticketGateReadingPayload(gate, kind, true)).catch(error => {
            logger.warn(`[Tickets] Could not unlock private ticket gate: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, Math.max(0, gate.timestamp + TICKET_GATE_DELAY_MS - Date.now()));
    timeout.unref?.();
}

async function handleTicketGateButton(interaction: ButtonInteraction): Promise<boolean> {
    const [, , action, type, userId, encodedTimestamp, signature] = interaction.customId.split(':');
    if (!signature || !['faq', 'tos', 'continue'].includes(action)) {
        await rejectTicketGate(interaction, 'This private ticket step expired. Select the ticket category again to restart.');
        return true;
    }

    const gate = parseTicketGate(
        interaction,
        action === 'continue' ? 'read' : 'choice',
        type,
        userId,
        encodedTimestamp,
        signature,
    );
    if (!gate) {
        await rejectTicketGate(interaction, 'This private ticket step expired. Select the ticket category again to restart.');
        return true;
    }

    if (action === 'faq' || action === 'tos') {
        const readingGate = newTicketGate(interaction, gate.type, 'read');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(ticketGateReadingPayload(readingGate, action, false));
        scheduleTicketGateUnlock(interaction, readingGate, action);
        return true;
    }

    if (Date.now() < gate.timestamp + TICKET_GATE_DELAY_MS) {
        await rejectTicketGate(interaction, 'Please spend at least 10 seconds reviewing the FAQ or Ticket TOS before continuing.');
        return true;
    }
    await interaction.showModal(createTicketModal(gate));
    return true;
}

export async function beginMarketplaceClaimTicketGate(interaction: ButtonInteraction): Promise<void> {
    const gate = newTicketGate(interaction, 'highrank', 'choice');
    await interaction.reply({
        content: [
            '## Claim a Marketplace Purchase',
            'Your claim will be handled through **⭐ Directorship / Ownership**.',
            '',
            'Before opening the claim ticket, please read either the FAQ or Ticket TOS.',
        ].join('\n'),
        components: [ticketGateChoiceRow(gate)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
}

function updatedClaimComponents(interaction: ButtonInteraction): unknown[] {
    const components = interaction.message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    const visit = (node: Record<string, unknown>): void => {
        if (node.custom_id === 'ticket:claim') {
            node.label = `Claimed by ${interaction.user.username}`.slice(0, 80);
            node.disabled = true;
            node.style = ButtonStyle.Success;
        }
        for (const child of (node.components as Array<Record<string, unknown>> | undefined) || []) visit(child);
    };
    for (const component of components) visit(component);
    return components;
}

function restoredClaimComponents(message: Message): unknown[] {
    const components = message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    const visit = (node: Record<string, unknown>): void => {
        if (node.custom_id === 'ticket:claim') {
            node.label = 'Claim';
            node.disabled = false;
            node.style = ButtonStyle.Success;
        }
        for (const child of (node.components as Array<Record<string, unknown>> | undefined) || []) visit(child);
    };
    for (const component of components) visit(component);
    return components;
}

function containsClaimButton(message: Message): boolean {
    const visit = (node: Record<string, unknown>): boolean => {
        if (node.custom_id === 'ticket:claim') return true;
        return ((node.components as Array<Record<string, unknown>> | undefined) || []).some(visit);
    };
    return message.components.some(component => visit(component.toJSON() as unknown as Record<string, unknown>));
}

async function findTicketPanelMessage(channel: TextChannel, metadata: TicketMetadata): Promise<Message | null> {
    if (metadata.panelMessageId) {
        const linked = await channel.messages.fetch(metadata.panelMessageId).catch(() => null);
        if (linked && containsClaimButton(linked)) return linked;
    }
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    return recent?.find(message => message.author.id === channel.client.user.id && containsClaimButton(message)) || null;
}

function escalationSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket:escalate-select')
            .setPlaceholder('Choose where to escalate this ticket')
            .addOptions(
                { label: 'Internal Affairs', value: 'internal', emoji: '📋' },
                { label: 'Management', value: 'management', emoji: '🏛️' },
                { label: 'Directorship / Ownership', value: 'highrank', emoji: '⭐' },
            ),
    );
}

async function escalateTicket(interaction: StringSelectMenuInteraction): Promise<void> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'This can only be used inside a ticket.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!isTicketStaff(interaction)) {
        await interaction.reply({ content: 'Only support staff can escalate tickets.', flags: MessageFlags.Ephemeral });
        return;
    }

    const metadata = decodeMetadata(channel.topic);
    if (!metadata) {
        await interaction.reply({ content: 'This is not a managed ticket.', flags: MessageFlags.Ephemeral });
        return;
    }

    const type = interaction.values[0] as TicketType;
    if (!['internal', 'management', 'highrank'].includes(type)) {
        await interaction.reply({ content: 'That escalation destination is unavailable.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const category = TICKET_CATEGORIES[type];
    const roleId = ticketRoleId(type);

    try {
        await channel.setParent(category.parentId, {
            lockPermissions: false,
            reason: `Ticket escalated to ${category.label} by ${interaction.user.tag}`,
        });
        await channel.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
        }, { reason: `Ticket escalated to ${category.label}` });

        metadata.type = type;
        await channel.setTopic(encodeMetadata(metadata), `Escalated to ${category.label}`);
        await channel.send({
            content: `<@&${roleId}> This ticket has been escalated to **${category.label}** by <@${interaction.user.id}>.`,
            allowedMentions: { parse: [], roles: [roleId] },
        });
        await interaction.editReply(`✅ Ticket escalated to **${category.label}**.`);
    } catch (error) {
        logger.error(`[Tickets] Escalation failed in ${channel.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('I could not escalate this ticket. Check my Manage Channels and role permissions.');
    }
}

export async function handleTicketSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId === 'ticket:escalate-select') {
        await escalateTicket(interaction);
        return true;
    }
    if (interaction.customId !== 'ticket:create-select') return false;

    const type = interaction.values[0] as TicketType;
    if (!(type in TICKET_CATEGORIES)) {
        await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const gate = newTicketGate(interaction, type, 'choice');
    await interaction.reply({
        components: [ticketGateChoicePanel(gate)],
        files: artwork(),
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    return true;
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId.startsWith('ticket-feedback:')) return handleTicketFeedbackButton(interaction);
    if (interaction.customId.startsWith('ticket:gate:')) return handleTicketGateButton(interaction);

    if (interaction.customId.startsWith('ticket:reroute-')) {
        const [prefix, token] = interaction.customId.split(':').slice(1).join(':').split(/:(?=[^:]+$)/);
        const pending = getPendingReroute(token, interaction.user.id);
        if (!pending) {
            await interaction.reply({ content: 'That private ticket choice expired. Please start again from the ticket panel.', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (prefix === 'reroute-ia') {
            await interaction.showModal(createTicketModalForType('internal', `ticket:reroute-ia-modal:${token}`));
            return true;
        }

        pendingReroutes.delete(token);
        if (prefix === 'reroute-management') {
            await createTicketFromData(interaction, 'management', pending.answers);
            return true;
        }
        if (prefix === 'reroute-original') {
            await createTicketFromData(interaction, pending.originalType, pending.answers);
            return true;
        }
    }

    if (!interaction.customId.startsWith('ticket:')) return false;

    if (interaction.customId === 'ticket:claim') {
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) return true;
        const metadata = decodeMetadata(channel.topic);
        if (!metadata) {
            await interaction.reply({ content: 'This is not a managed ticket.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!isTicketStaff(interaction)) {
            await interaction.reply({ content: 'Only support staff can claim tickets.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (metadata.claimedBy) {
            await interaction.reply({ content: `This ticket is already claimed by <@${metadata.claimedBy}>.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        metadata.claimedBy = interaction.user.id;
        await channel.setTopic(encodeMetadata(metadata));
        await interaction.update({ components: updatedClaimComponents(interaction) as never });
        await interaction.followUp({ content: `✅ Ticket claimed by <@${interaction.user.id}>.`, allowedMentions: { parse: [] } });
        return true;
    }

    if (interaction.customId === 'ticket:close') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await closeTicketWithLifecycle(interaction, 'Closed from the ticket panel.');
        return true;
    }

    if (interaction.customId === 'ticket:escalate') {
        if (!isTicketStaff(interaction)) {
            await interaction.reply({ content: 'Only support staff can escalate tickets.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({
            content: 'Choose where this ticket should be escalated:',
            components: [escalationSelect()],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (interaction.customId === 'ticket:close-request') {
        await interaction.showModal(closeRequestModal());
        return true;
    }

    if (interaction.customId === 'ticket:close-confirm') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await closeTicketWithLifecycle(interaction, 'Close request accepted.');
        return true;
    }

    if (interaction.customId === 'ticket:close-keep') {
        const channel = interaction.channel;
        const metadata = channel?.type === ChannelType.GuildText ? decodeMetadata(channel.topic) : null;
        if (!metadata || (interaction.user.id !== metadata.ownerId && !isTicketStaff(interaction))) {
            await interaction.reply({ content: 'Only the ticket opener or support staff can answer this request.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({ content: 'The ticket will remain open.', flags: MessageFlags.Ephemeral });
        await interaction.message.delete().catch(() => undefined);
        return true;
    }

    return false;
}

export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId.startsWith('ticket-feedback:')) return handleTicketFeedbackModal(interaction);

    if (interaction.customId.startsWith('ticket:reroute-ia-modal:')) {
        const token = interaction.customId.split(':').pop() || '';
        const pending = getPendingReroute(token, interaction.user.id);
        if (!pending) {
            await interaction.reply({ content: 'That Internal Affairs redirect expired. Please start again from the ticket panel.', flags: MessageFlags.Ephemeral });
            return true;
        }
        pendingReroutes.delete(token);
        await createTicketFromData(interaction, 'internal', modalAnswers(interaction, 'internal'));
        return true;
    }

    if (interaction.customId.startsWith('ticket:create-modal:')) {
        const [, , type, userId, encodedTimestamp, signature] = interaction.customId.split(':');
        if (!(type in TICKET_CATEGORIES)) return false;
        const gate = signature ? parseTicketGate(interaction, 'read', type, userId, encodedTimestamp, signature) : null;
        if (!gate || Date.now() < gate.timestamp + TICKET_GATE_DELAY_MS) {
            await interaction.reply({
                content: 'Before opening a ticket, select a category and review the FAQ or Ticket TOS for 10 seconds.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        const answers = modalAnswers(interaction, gate.type);
        await routeSubmittedTicket(interaction, gate.type, answers);
        return true;
    }

    if (interaction.customId === 'ticket:close-request-modal') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.editReply('This can only be used inside a ticket channel.');
            return true;
        }
        const metadata = decodeMetadata(channel.topic);
        if (!metadata) {
            await interaction.editReply('This is not a managed ticket channel.');
            return true;
        }
        const reason = interaction.fields.getTextInputValue('reason');
        await channel.send({
            components: [buildCloseRequestPanel(metadata.ownerId, interaction.user.id, reason)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [metadata.ownerId] },
        });
        await interaction.editReply('✅ Your close request was sent to the ticket opener.');
        return true;
    }

    return false;
}

export function isTicketPanelCommandName(commandName: string): boolean {
    return commandName.replace(/[-_\s]/g, '').toLowerCase() === 'ticketpanel' || commandName.toLowerCase() === 'ticket';
}

export function buildTicketPanelRefreshPayload() {
    return {
        components: [buildTicketLauncher()],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] as [] },
    };
}

export async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await interaction.client.channels.fetch(TICKET_PANEL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel) || !channel.isSendable()) {
        await interaction.editReply(`The ticket panel channel <#${TICKET_PANEL_CHANNEL_ID}> is unavailable.`);
        return;
    }

    try {
        const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existing = recent?.find(message =>
            message.author.id === interaction.client.user?.id
            && JSON.stringify(message.components.map(component => component.toJSON())).includes('ticket:create-select'),
        );
        const payload = buildTicketPanelRefreshPayload();
        if (existing) {
            await existing.edit({ ...payload, attachments: [] }).catch(async () => { await channel.send(payload); });
        } else {
            await channel.send(payload);
        }
        await interaction.editReply(`✅ The V2 Assistance ticket panel was refreshed in <#${TICKET_PANEL_CHANNEL_ID}>.`);
    } catch (error) {
        logger.error(`[Tickets] Could not refresh the ticket panel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await interaction.editReply(`I could not update <#${TICKET_PANEL_CHANNEL_ID}>. Check that I can view the channel, send messages, and attach files.`);
    }
}

const ticketPanelCommand = {
    data: new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('Post the Los Angeles Roleplay support ticket panel (legacy alias)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    execute: postTicketPanel,
};

const ticketPanelCompatibilityCommand = {
    data: new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription('Post the Los Angeles Roleplay V2 support ticket panel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    execute: postTicketPanel,
};

const ticketCommand = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage the Los Angeles Roleplay ticket system')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand => subcommand.setName('panel').setDescription('Post the V2 support ticket panel in the configured channel')),
    execute: postTicketPanel,
};

const closeCommand = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket and save its transcript')
        .setDMPermission(false),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!isTicketStaff(interaction)) {
            await interaction.reply({ content: 'Only support staff can use `/close`.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await closeTicketWithLifecycle(interaction, 'Closed with /close.');
    },
};

const closeRequestCommand = {
    data: new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Ask the ticket opener for permission to close this ticket')
        .setDMPermission(false),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!isTicketStaff(interaction)) {
            await interaction.reply({ content: 'Only support staff can use `/closerequest`.', flags: MessageFlags.Ephemeral });
            return;
        }
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText || !decodeMetadata(channel.topic)) {
            await interaction.reply({ content: 'This command can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.showModal(closeRequestModal());
    },
};

const unclaimCommand = {
    data: new SlashCommandBuilder().setName('unclaim').setDescription('Unclaim the current support ticket').setDMPermission(false),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
        if (!isTicketStaff(interaction)) {
            await interaction.editReply('Only support staff can unclaim tickets.');
            return;
        }
        const panelMessage = await findTicketPanelMessage(channel, metadata);
        if (!panelMessage) {
            await interaction.editReply('I could not find the ticket panel message, so the claim was not changed.');
            return;
        }
        const previousClaimant = metadata.claimedBy;
        delete metadata.claimedBy;
        metadata.panelMessageId = panelMessage.id;
        await channel.setTopic(encodeMetadata(metadata), `Ticket unclaimed by ${interaction.user.id}`);
        try {
            await panelMessage.edit({
                components: restoredClaimComponents(panelMessage) as never,
                flags: MessageFlags.IsComponentsV2,
                attachments: Array.from(panelMessage.attachments.values()),
            });
        } catch (error) {
            if (previousClaimant) {
                metadata.claimedBy = previousClaimant;
                await channel.setTopic(encodeMetadata(metadata), 'Restoring ticket claim after panel update failure').catch(() => undefined);
            }
            logger.error(`[Tickets] Could not restore the claim button in ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await interaction.editReply('I could not restore the Claim button, so the existing claim was kept.');
            return;
        }
        await interaction.editReply(previousClaimant
            ? `✅ Ticket unclaimed. It was previously claimed by <@${previousClaimant}>.`
            : '✅ The ticket was already unclaimed; the Claim button has been restored.');
    },
};

async function updateTicketMemberAccess(interaction: ChatInputCommandInteraction, add: boolean): Promise<void> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText || !decodeMetadata(channel.topic)) {
        await interaction.reply({ content: 'This command can only be used inside a managed ticket channel.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!isTicketStaff(interaction)) {
        await interaction.reply({ content: 'Only support staff can change ticket members.', flags: MessageFlags.Ephemeral });
        return;
    }

    const member = interaction.options.getUser('member', true);
    if (member.id === interaction.client.user.id) {
        await interaction.reply({ content: 'I cannot remove my own ticket access.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply();
    try {
        await channel.permissionOverwrites.edit(member.id, {
            ViewChannel: add,
            SendMessages: add,
            ReadMessageHistory: add,
            AttachFiles: add,
            EmbedLinks: add,
            AddReactions: add,
            UseApplicationCommands: add,
        }, { reason: `${add ? 'Added to' : 'Removed from'} ticket by ${interaction.user.tag}` });
        await interaction.editReply({
            content: add
                ? `✅ <@${member.id}> was added to this ticket by <@${interaction.user.id}>. They can now view and send messages here.`
                : `✅ <@${member.id}> was removed from this ticket by <@${interaction.user.id}>.`,
            allowedMentions: { parse: [], users: add ? [member.id] : [] },
        });
    } catch (error) {
        logger.error(`[Tickets] Could not ${add ? 'add' : 'remove'} ${member.id} in ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await interaction.editReply(`I could not ${add ? 'add' : 'remove'} that member. Check that I have Manage Channels.`);
    }
}

const addMemberCommand = {
    data: new SlashCommandBuilder()
        .setName('add-member')
        .setDescription('Add a member to the current support ticket')
        .setDMPermission(false)
        .addUserOption(option => option.setName('member').setDescription('Member to add to this ticket').setRequired(true)),
    execute: (interaction: ChatInputCommandInteraction) => updateTicketMemberAccess(interaction, true),
};

const removeMemberCommand = {
    data: new SlashCommandBuilder()
        .setName('remove-member')
        .setDescription('Remove a member from the current support ticket')
        .setDMPermission(false)
        .addUserOption(option => option.setName('member').setDescription('Member to remove from this ticket').setRequired(true)),
    execute: (interaction: ChatInputCommandInteraction) => updateTicketMemberAccess(interaction, false),
};

export const ticketCommands = [
    ticketCommand,
    ticketPanelCommand,
    ticketPanelCompatibilityCommand,
    closeCommand,
    closeRequestCommand,
    unclaimCommand,
    addMemberCommand,
    removeMemberCommand,
];
