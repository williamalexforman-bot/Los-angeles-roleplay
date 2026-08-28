import { resolve } from 'path';
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
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';
import { SUPPORT_FAQ, TICKET_TERMS } from './supportContent';

const BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const BANNER_PATH = resolve(__dirname, '..', '..', 'assets', BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID || '1526034504953892925';
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID || process.env.GENERAL_SUPPORT_ROLE_ID || '1523122697746382868';
const INTERNAL_ROLE_ID = process.env.INTERNAL_AFFAIRS_ROLE_ID || '1521593407816990811';

const CATEGORIES = {
    general: {
        label: 'General Support', emoji: '🎫', prefix: 'gen',
        parentId: process.env.GENERAL_TICKET_CATEGORY_ID || '1526254341646712883',
        roleId: SUPPORT_ROLE_ID,
    },
    internal: {
        label: 'Internal Affairs Support', emoji: '📋', prefix: 'ia',
        parentId: process.env.INTERNAL_TICKET_CATEGORY_ID || '1526254402426503320',
        roleId: INTERNAL_ROLE_ID,
    },
    management: {
        label: 'Management Support', emoji: '🏛️', prefix: 'mgmt',
        parentId: process.env.MANAGEMENT_TICKET_CATEGORY_ID || '1526254462128099479',
        roleId: process.env.MANAGEMENT_ROLE_ID || SUPPORT_ROLE_ID,
    },
    highrank: {
        label: 'Directorship / Ownership', emoji: '⭐', prefix: 'hr',
        parentId: process.env.HIGH_RANK_TICKET_CATEGORY_ID || '1526254518570844231',
        roleId: process.env.HIGH_RANK_ROLE_ID || SUPPORT_ROLE_ID,
    },
} as const;

type TicketType = keyof typeof CATEGORIES;
type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

function isTicketType(value: string): value is TicketType {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

function metadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata;
        return parsed?.ownerId && isTicketType(parsed.type) ? parsed : null;
    } catch {
        return null;
    }
}

function encodeMetadata(value: TicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}

function cleanName(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22) || 'support';
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(BANNER_PATH, { name: BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function ticketSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket:create-select')
            .setPlaceholder('Select the correct support category')
            .addOptions(Object.entries(CATEGORIES).map(([value, item]) => ({
                label: item.label,
                value,
                emoji: item.emoji,
            }))),
    );
}

function launcherPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🎫 Los Angeles Roleplay Support',
            'Welcome to the Los Angeles Roleplay support system. Select the option that best matches what you need.',
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
            '*Realism at its Finest*',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addActionRowComponents(ticketSelectRow())
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function continueRow(type: TicketType, userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket:continue:${type}:${userId}`)
            .setLabel('Continue to Ticket Form')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Primary),
    );
}

function reviewPanel(type: TicketType, userId: string): ContainerBuilder {
    const config = CATEGORIES[type];
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## ${config.emoji} ${config.label}`,
            'Before opening your ticket, review the FAQ and Ticket Terms of Service below.',
            '',
            SUPPORT_FAQ,
        ].join('\n').slice(0, 3_800)))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            TICKET_TERMS,
            '',
            '**Press Continue to open the ticket form.**',
        ].join('\n').slice(0, 3_800)))
        .addSeparatorComponents(separator())
        .addActionRowComponents(continueRow(type, userId))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function input(id: string, label: string, style: TextInputStyle, required = true): ActionRowBuilder<TextInputBuilder> {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(style)
            .setRequired(required)
            .setMaxLength(style === TextInputStyle.Short ? 100 : 1000),
    );
}

function ticketModal(type: TicketType): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`ticket:create:${type}`)
        .setTitle(`${CATEGORIES[type].label} Ticket`.slice(0, 45));
    if (type === 'internal') {
        return modal.addComponents(
            input('reported_user', 'Who are you reporting?', TextInputStyle.Short),
            input('reason', 'Reason for report', TextInputStyle.Paragraph),
            input('proof', 'Do you have proof?', TextInputStyle.Paragraph),
            input('details', 'Anything else?', TextInputStyle.Paragraph, false),
        );
    }
    return modal.addComponents(
        input('reason', 'Reason for opening ticket', TextInputStyle.Paragraph),
        input('details', 'Additional details', TextInputStyle.Paragraph, false),
    );
}

function actionRow(claimedBy?: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket:claim')
            .setLabel(claimedBy ? `Claimed by ${claimedBy}`.slice(0, 80) : 'Claim')
            .setStyle(ButtonStyle.Success)
            .setDisabled(Boolean(claimedBy)),
        new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:escalate').setLabel('Escalate').setStyle(ButtonStyle.Secondary),
    );
}

function memberHasRole(member: unknown, roleId: string): boolean {
    const guildMember = member as GuildMember | null;
    return Boolean(guildMember?.roles && 'cache' in guildMember.roles && guildMember.roles.cache.has(roleId));
}

function isStaff(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    const roleIds = new Set([
        SUPPORT_ROLE_ID,
        INTERNAL_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value)));
    return [...roleIds].some(roleId => memberHasRole(interaction.member, roleId));
}

async function resolveExistingRole(guild: NonNullable<ModalSubmitInteraction['guild']>, preferredRoleId: string) {
    const preferred = guild.roles.cache.get(preferredRoleId) || await guild.roles.fetch(preferredRoleId).catch(() => null);
    if (preferred) return preferred;
    if (preferredRoleId === SUPPORT_ROLE_ID) return null;
    return guild.roles.cache.get(SUPPORT_ROLE_ID) || await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
}

function optionalField(interaction: ModalSubmitInteraction, id: string): string {
    try {
        return interaction.fields.getTextInputValue(id).trim();
    } catch {
        return '';
    }
}

function openTicketPanel(params: {
    type: TicketType;
    userId: string;
    roleId?: string;
    reason: string;
    reportedUser?: string;
    proof?: string;
    details?: string;
}): ContainerBuilder {
    const config = CATEGORIES[params.type];
    const lines = [
        params.roleId ? `<@${params.userId}> • <@&${params.roleId}>` : `<@${params.userId}>`,
        `## ${config.emoji} ${config.label} Ticket`,
        'Welcome to **Los Angeles Roleplay**. A staff member will assist you shortly.',
        '',
        `**Opened By:** <@${params.userId}>`,
        '**Reason:**',
        params.reason.slice(0, 1_400),
    ];
    if (params.reportedUser) lines.push('', '**User Reported:**', params.reportedUser.slice(0, 500));
    if (params.proof) lines.push('', '**Proof:**', params.proof.slice(0, 1_000));
    if (params.details) lines.push('', '**Additional Details:**', params.details.slice(0, 1_000));

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 3_900)))
        .addSeparatorComponents(separator())
        .addActionRowComponents(actionRow())
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
        if (interaction.deferred) await interaction.editReply('Tickets can only be opened inside the server.');
        else await interaction.reply({ content: 'Tickets can only be opened inside the server.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const config = CATEGORIES[type];
    const reason = optionalField(interaction, 'reason') || 'support';
    const details = optionalField(interaction, 'details');
    const reportedUser = optionalField(interaction, 'reported_user');
    const proof = optionalField(interaction, 'proof');
    const role = await resolveExistingRole(guild, config.roleId);

    const overwrites: any[] = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
        },
        {
            id: interaction.client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
        },
    ];
    if (role) {
        overwrites.push({
            id: role.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
        });
    }

    let channel: TextChannel | null = null;
    try {
        channel = await guild.channels.create({
            name: `${config.prefix}-${cleanName(reason)}-${interaction.user.id.slice(-4)}`.slice(0, 40),
            type: ChannelType.GuildText,
            permissionOverwrites: overwrites,
            topic: encodeMetadata({ ownerId: interaction.user.id, type, createdAt: new Date().toISOString() }),
            reason: `${config.label} ticket opened by ${interaction.user.tag}`,
        });
        logger.info(`[Tickets] CHANNEL_CREATED type=${type} channel=${channel.id} user=${interaction.user.id}`);

        const parent = guild.channels.cache.get(config.parentId) || await guild.channels.fetch(config.parentId).catch(() => null);
        if (parent?.type === ChannelType.GuildCategory) {
            await channel.setParent(parent.id, { lockPermissions: false, reason: `${config.label} ticket routing` }).catch(error => {
                logger.warn(`[Tickets] MOVE_FAILED channel=${channel?.id} parent=${config.parentId}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }

        const panel = await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [openTicketPanel({
                type,
                userId: interaction.user.id,
                roleId: role?.id,
                reason,
                reportedUser,
                proof,
                details,
            })],
            files: artwork(),
            allowedMentions: { parse: [], users: [interaction.user.id], roles: role ? [role.id] : [] },
        });

        await channel.setTopic(encodeMetadata({
            ownerId: interaction.user.id,
            type,
            createdAt: new Date().toISOString(),
            panelMessageId: panel.id,
        }), 'Ticket metadata').catch(() => undefined);

        await interaction.editReply(`✅ Your ${config.label} ticket has been created: <#${channel.id}>`);
        logger.info(`[Tickets] COMPLETE type=${type} channel=${channel.id} user=${interaction.user.id} role=${role?.id || 'none'}`);
    } catch (error) {
        logger.error(`[Tickets] CREATE_FAILED type=${type} channel=${channel?.id || 'none'} error=${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (channel) await interaction.editReply(`Your ticket channel exists but setup did not fully finish: <#${channel.id}>`).catch(() => undefined);
        else await interaction.editReply('Unable to create your ticket. Please contact an administrator.').catch(() => undefined);
    }
}

async function currentTicket(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<{ channel: TextChannel; data: TicketMetadata } | null> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    const data = metadata(channel.topic);
    return data ? { channel, data } : null;
}

async function closeChannel(channel: TextChannel, actorId: string): Promise<void> {
    logger.info(`[Tickets] CLOSED channel=${channel.id} by=${actorId}`);
    await channel.delete(`Ticket closed by ${actorId}`);
}

export async function handleTicketSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'ticket:create-select') return false;
    const type = interaction.values[0] || '';
    if (!isTicketType(type)) {
        if (interaction.deferred) await interaction.editReply('That ticket category is unavailable.');
        else await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const started = Date.now();
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    logger.info(`[Tickets] ACK_SELECT type=${type} user=${interaction.user.id} ms=${Date.now() - started} preAck=${interaction.deferred}`);

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [reviewPanel(type, interaction.user.id)],
        files: artwork(),
    });
    logger.info(`[Tickets] REVIEW_READY type=${type} user=${interaction.user.id}`);
    return true;
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId.startsWith('ticket:continue:')) {
        const [, , typeValue, ownerId] = interaction.customId.split(':');
        if (!isTicketType(typeValue) || ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'This ticket form is not available to you.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(ticketModal(typeValue));
        logger.info(`[Tickets] MODAL_OPEN type=${typeValue} user=${interaction.user.id}`);
        return true;
    }

    if (interaction.customId.startsWith('ticket:close-confirm:')) {
        const allowedId = interaction.customId.split(':')[3];
        const current = await currentTicket(interaction);
        if (!current) return false;
        if (interaction.user.id !== allowedId && !isStaff(interaction)) {
            await interaction.reply({ content: 'You cannot confirm this close action.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({ content: 'Closing ticket…', flags: MessageFlags.Ephemeral });
        await closeChannel(current.channel, interaction.user.id);
        return true;
    }

    if (interaction.customId === 'ticket:close-cancel') {
        await interaction.update({ content: 'Ticket closure cancelled.', components: [] });
        return true;
    }

    const current = await currentTicket(interaction);
    if (!current) return false;

    if (interaction.customId === 'ticket:claim') {
        if (!isStaff(interaction)) {
            await interaction.reply({ content: 'Only ticket staff can claim tickets.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const next = { ...current.data, claimedBy: interaction.user.id };
        await current.channel.setTopic(encodeMetadata(next), 'Ticket claimed').catch(() => undefined);
        await interaction.update({ components: [actionRow(interaction.user.username)] });
        return true;
    }

    if (interaction.customId === 'ticket:close') {
        if (interaction.user.id !== current.data.ownerId && !isStaff(interaction)) {
            await interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({
            content: 'Are you sure you want to close this ticket?',
            flags: MessageFlags.Ephemeral,
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`ticket:close-confirm:${interaction.user.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket:close-cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
            )],
        });
        return true;
    }

    if (interaction.customId === 'ticket:escalate') {
        if (!isStaff(interaction)) {
            await interaction.reply({ content: 'Only ticket staff can escalate tickets.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const highRoleId = process.env.HIGH_RANK_ROLE_ID;
        const role = highRoleId ? await interaction.guild?.roles.fetch(highRoleId).catch(() => null) : null;
        if (role) {
            await current.channel.permissionOverwrites.edit(role.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
            });
            await current.channel.send({ content: `<@&${role.id}> This ticket has been escalated by <@${interaction.user.id}>.`, allowedMentions: { roles: [role.id], users: [interaction.user.id] } });
        } else {
            await current.channel.send(`⚠️ Ticket escalated by <@${interaction.user.id}>. No High Rank role is currently configured, so server management should review manually.`);
        }
        await interaction.reply({ content: 'Ticket escalated.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === 'ticket:close-request-confirm') {
        if (interaction.user.id !== current.data.ownerId && !isStaff(interaction)) {
            await interaction.reply({ content: 'Only the ticket owner or staff can approve this request.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({ content: 'Closing ticket…', flags: MessageFlags.Ephemeral });
        await closeChannel(current.channel, interaction.user.id);
        return true;
    }

    if (interaction.customId === 'ticket:close-request-keep') {
        if (interaction.user.id !== current.data.ownerId && !isStaff(interaction)) {
            await interaction.reply({ content: 'Only the ticket owner or staff can respond to this request.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.update({ content: `✅ <@${interaction.user.id}> chose to keep this ticket open.`, components: [] });
        return true;
    }

    return false;
}

export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ticket:create:')) return false;
    const type = interaction.customId.split(':')[2] || '';
    if (!isTicketType(type)) {
        if (interaction.deferred) await interaction.editReply('That ticket category is unavailable.');
        else await interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }
    await createTicket(interaction, type);
    return true;
}

async function postLauncher(interaction: ChatInputCommandInteraction, ephemeral: boolean): Promise<void> {
    await interaction.reply({
        flags: ephemeral
            ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            : MessageFlags.IsComponentsV2,
        components: [launcherPanel()],
        files: artwork(),
    });
}

const ticketCommand = {
    data: new SlashCommandBuilder().setName('ticket').setDescription('Open the ticket support menu'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await postLauncher(interaction, true);
    },
};

function panelCommand(name: 'ticket-panel' | 'ticketpanel') {
    return {
        data: new SlashCommandBuilder().setName(name).setDescription('Post the ticket support panel'),
        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            if (!isStaff(interaction)) {
                await interaction.reply({ content: 'You do not have permission to post the ticket panel.', flags: MessageFlags.Ephemeral });
                return;
            }
            const channel = interaction.guild?.channels.cache.get(PANEL_CHANNEL_ID);
            if (channel?.isTextBased() && 'send' in channel) {
                await (channel as TextChannel).send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [launcherPanel()],
                    files: artwork(),
                });
                await interaction.reply({ content: `✅ Ticket panel posted in <#${PANEL_CHANNEL_ID}>.`, flags: MessageFlags.Ephemeral });
            } else {
                await postLauncher(interaction, false);
            }
        },
    };
}

const closeCommand = {
    data: new SlashCommandBuilder().setName('close').setDescription('Close the current ticket'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const current = await currentTicket(interaction);
        if (!current) {
            await interaction.reply({ content: 'This command can only be used inside a ticket.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== current.data.ownerId && !isStaff(interaction)) {
            await interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.reply({ content: 'Closing ticket…', flags: MessageFlags.Ephemeral });
        await closeChannel(current.channel, interaction.user.id);
    },
};

const closeRequestCommand = {
    data: new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Ask the ticket owner if this ticket can be closed')
        .addStringOption(option => option.setName('reason').setDescription('Reason for closing').setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const current = await currentTicket(interaction);
        if (!current) {
            await interaction.reply({ content: 'This command can only be used inside a ticket.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!isStaff(interaction)) {
            await interaction.reply({ content: 'Only ticket staff can send close requests.', flags: MessageFlags.Ephemeral });
            return;
        }
        const reason = interaction.options.getString('reason') || 'The issue appears to be resolved.';
        await current.channel.send({
            content: `<@${current.data.ownerId}> Staff would like to close this ticket.\n**Reason:** ${reason.slice(0, 1000)}`,
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('ticket:close-request-confirm').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket:close-request-keep').setLabel('Keep Open').setStyle(ButtonStyle.Secondary),
            )],
            allowedMentions: { users: [current.data.ownerId] },
        });
        await interaction.reply({ content: 'Close request sent.', flags: MessageFlags.Ephemeral });
    },
};

const unclaimCommand = {
    data: new SlashCommandBuilder().setName('unclaim').setDescription('Unclaim the current ticket'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const current = await currentTicket(interaction);
        if (!current || !isStaff(interaction)) {
            await interaction.reply({ content: 'This command can only be used by ticket staff inside a ticket.', flags: MessageFlags.Ephemeral });
            return;
        }
        const next = { ...current.data };
        delete next.claimedBy;
        await current.channel.setTopic(encodeMetadata(next), 'Ticket unclaimed');
        if (next.panelMessageId) {
            const panel = await current.channel.messages.fetch(next.panelMessageId).catch(() => null);
            if (panel) await panel.edit({ components: [openTicketPanel({ type: next.type, userId: next.ownerId, reason: 'Ticket remains open.' })], flags: MessageFlags.IsComponentsV2 }).catch(() => undefined);
        }
        await interaction.reply({ content: 'Ticket unclaimed.', flags: MessageFlags.Ephemeral });
    },
};

function memberPermissionCommand(name: 'add-member' | 'remove-member', add: boolean) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(`${add ? 'Add' : 'Remove'} a member ${add ? 'to' : 'from'} the current ticket`)
            .addUserOption(option => option.setName('member').setDescription('Member').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            const current = await currentTicket(interaction);
            if (!current || !isStaff(interaction)) {
                await interaction.reply({ content: 'This command can only be used by ticket staff inside a ticket.', flags: MessageFlags.Ephemeral });
                return;
            }
            const user = interaction.options.getUser('member', true);
            await current.channel.permissionOverwrites.edit(user.id, add ? {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
            } : { ViewChannel: false });
            await interaction.reply({
                content: `${add ? 'Added' : 'Removed'} <@${user.id}> ${add ? 'to' : 'from'} this ticket.`,
                allowedMentions: { users: [] },
                flags: MessageFlags.Ephemeral,
            });
        },
    };
}

export const ticketCommands = [
    ticketCommand,
    panelCommand('ticket-panel'),
    panelCommand('ticketpanel'),
    closeCommand,
    closeRequestCommand,
    unclaimCommand,
    memberPermissionCommand('add-member', true),
    memberPermissionCommand('remove-member', false),
];
