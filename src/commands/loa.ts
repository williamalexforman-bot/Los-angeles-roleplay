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
const LOA_MANAGEMENT_PERMISSION = PermissionFlagsBits.Administrator;

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

function loaRequestPanelEmbed(): EmbedBuilder {
    return brandedEmbed('📋 Leave of Absence (LOA)')
        .setDescription(
            'Taking a **Leave of Absence (LOA)** allows you to step away from your duties while keeping your rank.\n\n'
            + '**If you want to have an LOA, you must request it.**\n'
            + 'Click the red **Request LOA** button below and fill out the form with your name, the start and end dates, and the reason for your leave.\n\n'
            + 'A member of management will review your request and approve or deny it.',
        );
}

function requestActionRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('loa:request:open')
            .setLabel('Request LOA')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Danger),
    );
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
            { name: 'Reason', value: active.reason },
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
        if (LOA_ROLE_ID && !member.roles.cache.has(LOA_ROLE_ID)) await member.roles.add(LOA_ROLE_ID, 'LOA approved');
        return true;
    } catch (error) {
        logger.warn(`Could not assign LOA role to ${member.user.tag} (${member.id}): ${error instanceof Error ? error.message : 'Unknown'}`);
        return false;
    }
}

async function removeLoaRole(member: GuildMember): Promise<boolean> {
    try {
        if (LOA_ROLE_ID && member.roles.cache.has(LOA_ROLE_ID)) await member.roles.remove(LOA_ROLE_ID, 'LOA period ended');
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
    // Allow the timer to keep Node alive for long leaves (up to a safe maximum).
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
            { name: 'Reason', value: active.reason },
        );
    await member.send({ embeds: [dmEmbed], files: [createLogoAttachment()] }).catch(() => {
        logger.warn(`Could not send LOA approval DM to ${member.user.tag} (${member.id}).`);
    });
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
        const pending = inMemoryPending.get(pendingId);
        if (!pending) {
            await interaction.reply({ content: 'This LOA request has already been processed.', flags: MessageFlags.Ephemeral });
            return true;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!interaction.memberPermissions?.has(LOA_MANAGEMENT_PERMISSION)) {
                await interaction.editReply('Only management may approve or deny LOA requests.');
                return true;
            }

            pending.approvedBy = interaction.user.id;
            clearTimeout(pending.timer);
            inMemoryPending.delete(pendingId);

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

                if (member) {
                    await assignLoaRole(member);
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
                    });
                }

                await interaction.editReply(`✅ LOA for **${pending.name}** approved. The member was notified, the LOA role was assigned, and the approved LOA was posted to <#${LOA_REQUEST_CHANNEL_ID}>.`);
                return true;
            }

            if (action === 'deny') {
                if (member) {
                    const dmEmbed = brandedEmbed('❌ Your LOA Was Denied', 0xef4444)
                        .setDescription(`We are sorry, **${pending.name}**, your Leave of Absence request was not approved.`)
                        .addFields(
                            { name: 'Requested Start', value: dateTimestamp(pending.startDate), inline: true },
                            { name: 'Requested End', value: dateTimestamp(pending.endDate), inline: true },
                            { name: 'Reason Provided', value: pending.reason },
                            { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                        );
                    await member.send({ embeds: [dmEmbed], files: [createLogoAttachment()] }).catch(() => {
                        logger.warn(`Could not send LOA denial DM to ${member.user.tag} (${member.id}).`);
                    });
                }

                const channel = await interaction.client.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null);
                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${pending.userId}>`,
                        embeds: [deniedEmbed(pending.memberUsername)],
                        files: [createLogoAttachment()],
                        allowedMentions: { parse: [], users: [pending.userId] },
                    });
                }

                await interaction.editReply(`❌ LOA for **${pending.name}** was denied. The member was notified.`);
                return true;
            }
        } catch (error) {
            logger.error(`LOA review failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            await interaction.editReply('Unable to process this LOA review right now. Please try again later.');
            return true;
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

        if (!name || !startDate || !endDate || !reason) {
            await interaction.editReply('All fields are required. Please submit the form again.');
            return true;
        }

        const pendingId = `${interaction.user.id}-${Date.now()}`;
        const pending: PendingLoa = {
            guildId: interaction.guildId || '',
            userId: interaction.user.id,
            memberUsername: interaction.user.username,
            name,
            startDate,
            endDate,
            reason,
            requestedAt: new Date().toISOString(),
            timer: setTimeout(() => {
                if (inMemoryPending.has(pendingId)) inMemoryPending.delete(pendingId);
            }, 7 * 24 * 60 * 60 * 1_000),
        };
        inMemoryPending.set(pendingId, pending);

        const channel = await interaction.client.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            inMemoryPending.delete(pendingId);
            clearTimeout(pending.timer);
            await interaction.editReply('The LOA request channel is unavailable. Please contact an administrator.');
            return true;
        }

        await channel.send({
            content: `<@${interaction.user.id}>`,
            embeds: [requestEmbed(pending)],
            components: reviewActionRows(pendingId),
            files: [createLogoAttachment()],
            allowedMentions: { parse: [], users: [interaction.user.id] },
        });

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
        .setDescription('Manage Leave of Absence requests')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Post the LOA request panel in the current channel'),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View active LOA requests and their status'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'setup') {
                if (!interaction.memberPermissions?.has(LOA_MANAGEMENT_PERMISSION)) {
                    await interaction.editReply('Only management may post the LOA request panel.');
                    return;
                }

                const channel = interaction.channel;
                if (!channel?.isSendable()) {
                    await interaction.editReply('This channel cannot receive the LOA panel.');
                    return;
                }

                await channel.send({
                    embeds: [loaRequestPanelEmbed()],
                    components: [requestActionRow()],
                    files: [createLogoAttachment()],
                });
                await interaction.editReply('✅ The LOA request panel has been posted.');
                return;
            }

            if (subcommand === 'status') {
                if (inMemoryPending.size === 0 && inMemoryActive.size === 0) {
                    await interaction.editReply('There are no LOA requests currently being tracked.');
                    return;
                }

                const lines: string[] = [];
                for (const loa of inMemoryPending.values()) {
                    lines.push(`🕐 **Pending:** <@${loa.userId}> — ${loa.name} (${loa.startDate} → ${loa.endDate})`);
                }
                for (const loa of inMemoryActive.values()) {
                    lines.push(`✅ **Active:** <@${loa.userId}> — ${loa.name} (${loa.startDate} → ${loa.endDate})`);
                }

                await interaction.editReply({
                    embeds: [brandedEmbed('📋 LOA Status').setDescription(lines.slice(0, 20).join('\n') || 'No LOA requests tracked.')],
                    files: [createLogoAttachment()],
                });
                return;
            }
        } catch (error) {
            console.error('[LOA] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to process the LOA command. Please try again later.');
        }
    },
};

