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
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { isDatabaseAvailable } from '../database/connection';
import { LoaRequest as LoaRequestModel } from '../database/models';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const LOA_REVIEW_CHANNEL_ID = process.env.LOA_REQUEST_CHANNEL_ID || '1528206019237515344';
const LOA_REQUESTER_ROLE_ID = process.env.LOA_REQUESTER_ROLE_ID || '';
const LOA_REQUESTER_ROLE_REQUIRED = Boolean(process.env.LOA_REQUESTER_ROLE_ID);
const DAYS_PER_PAGE = 20;
const MAX_PAGE = 18;

type LoaModule = {
    handleLoaButton: (interaction: ButtonInteraction) => Promise<boolean>;
    handleLoaModal: (interaction: ModalSubmitInteraction) => Promise<boolean>;
    loaCommand: {
        execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    };
};

interface CalendarState {
    guildId: string;
    userId: string;
    startDate?: string;
    endDate?: string;
    createdAt: number;
}

const states = new Map<string, CalendarState>();
let installed = false;

function stateKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

function todayUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string, endOfDay = false): Date | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = endOfDay
        ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
        : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    if (parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day) return null;
    return parsed;
}

function friendlyDate(value: string): string {
    const date = parseIsoDate(value);
    if (!date) return value;
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date);
}

function shortDateLabel(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(date).slice(0, 18);
}

function dateTimestamp(value: string, endOfDay = false): string {
    const parsed = parseIsoDate(value, endOfDay);
    if (!parsed) return value;
    return `<t:${Math.floor(parsed.getTime() / 1_000)}:F>`;
}

function memberHasRole(interaction: ChatInputCommandInteraction | ButtonInteraction, roleId: string): boolean {
    const member = interaction.member;
    if (!member || !roleId) return false;
    const roles = (member as { roles?: { cache?: { has(id: string): boolean } } | string[] }).roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes(roleId);
    return roles.cache?.has(roleId) ?? false;
}

async function canRequestLoa(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (!LOA_REQUESTER_ROLE_REQUIRED) return true;
    if (memberHasRole(interaction, LOA_REQUESTER_ROLE_ID)) return true;
    try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        return member.roles.cache.has(LOA_REQUESTER_ROLE_ID);
    } catch {
        return false;
    }
}

function calendarBase(state: CalendarState, mode: 'start' | 'end'): Date {
    if (mode === 'end' && state.startDate) return parseIsoDate(state.startDate) || todayUtc();
    return todayUtc();
}

function calendarRows(
    state: CalendarState,
    mode: 'start' | 'end',
    page: number,
): ActionRowBuilder<ButtonBuilder>[] {
    const safePage = Math.max(0, Math.min(MAX_PAGE, page));
    const base = addDays(calendarBase(state, mode), safePage * DAYS_PER_PAGE);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let column = 0; column < 5; column += 1) {
            const date = addDays(base, rowIndex * 5 + column);
            const value = isoDate(date);
            const selected = mode === 'start' ? state.startDate === value : state.endDate === value;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`loa:calendar:pick:${mode}:${value}`)
                    .setLabel(shortDateLabel(date))
                    .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary),
            );
        }
        rows.push(row);
    }

    rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`loa:calendar:page:${mode}:${Math.max(0, safePage - 1)}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId('loa:calendar:cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`loa:calendar:page:${mode}:${Math.min(MAX_PAGE, safePage + 1)}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(safePage >= MAX_PAGE),
        ),
    );
    return rows;
}

function calendarContent(state: CalendarState, mode: 'start' | 'end', page: number): string {
    const selectedStart = state.startDate ? `**Start:** ${friendlyDate(state.startDate)}` : '**Start:** Not selected';
    const selectedEnd = state.endDate ? `**End:** ${friendlyDate(state.endDate)}` : '**End:** Not selected';
    const direction = mode === 'start' ? 'start' : 'end';
    return [
        `## 📅 Select your LOA ${direction} date`,
        'Click one of the date buttons below. Use **Previous** and **Next** to move through the calendar.',
        '',
        selectedStart,
        selectedEnd,
        `-# Calendar page ${page + 1} of ${MAX_PAGE + 1}`,
    ].join('\n');
}

function summaryPayload(state: CalendarState) {
    return {
        content: [
            '## 📅 LOA Dates Selected',
            `**Start Date:** ${state.startDate ? friendlyDate(state.startDate) : 'Not selected'}`,
            `**End Date:** ${state.endDate ? friendlyDate(state.endDate) : 'Not selected'}`,
            '',
            'If these dates are correct, press **Continue** to enter your name and reason.',
        ].join('\n'),
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('loa:calendar:edit:start')
                    .setLabel('Edit Start')
                    .setEmoji('📅')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('loa:calendar:edit:end')
                    .setLabel('Edit End')
                    .setEmoji('📅')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('loa:calendar:continue')
                    .setLabel('Continue')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!state.startDate || !state.endDate),
                new ButtonBuilder()
                    .setCustomId('loa:calendar:cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger),
            ),
        ],
    };
}

function detailsModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('loa:calendar:details')
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
                    .setCustomId('reason')
                    .setLabel('Reason for LOA')
                    .setPlaceholder('Why do you need a leave of absence?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setRequired(true),
            ),
        );
}

function requestEmbed(
    userId: string,
    name: string,
    startDate: string,
    endDate: string,
    reason: string,
    requestedAt: Date,
): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle('📝 LOA Request Submitted')
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Requested By', value: `<@${userId}>`, inline: true },
            { name: 'Name', value: name, inline: true },
            { name: 'Start Date', value: dateTimestamp(startDate), inline: true },
            { name: 'End Date', value: dateTimestamp(endDate, true), inline: true },
            { name: 'Reason', value: reason },
            { name: 'Submitted At', value: `<t:${Math.floor(requestedAt.getTime() / 1_000)}:F>`, inline: true },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp(requestedAt);
}

function reviewRows(pendingId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`loa:review:approve:${pendingId}`)
                .setLabel('Approve')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`loa:review:deny:${pendingId}`)
                .setLabel('Deny')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
}

async function beginCalendar(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
        const payload = { content: 'This can only be used in a server.', flags: MessageFlags.Ephemeral as const };
        if (interaction.isButton()) await interaction.reply(payload);
        else await interaction.reply(payload);
        return;
    }

    if (!(await canRequestLoa(interaction))) {
        const payload = {
            content: `You need the <@&${LOA_REQUESTER_ROLE_ID}> role to request a Leave of Absence.`,
            flags: MessageFlags.Ephemeral as const,
        };
        await interaction.reply(payload);
        return;
    }

    const state: CalendarState = {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        createdAt: Date.now(),
    };
    states.set(stateKey(state.guildId, state.userId), state);

    await interaction.reply({
        content: calendarContent(state, 'start', 0),
        components: calendarRows(state, 'start', 0),
        flags: MessageFlags.Ephemeral,
    });
}

function getState(interaction: ButtonInteraction | ModalSubmitInteraction): CalendarState | null {
    if (!interaction.guildId) return null;
    const key = stateKey(interaction.guildId, interaction.user.id);
    const state = states.get(key) || null;
    if (state && Date.now() - state.createdAt > 30 * 60 * 1_000) {
        states.delete(key);
        return null;
    }
    return state;
}

async function persistRequest(
    pendingId: string,
    interaction: ModalSubmitInteraction,
    name: string,
    reason: string,
    state: CalendarState,
    channelId: string,
    messageId: string,
    requestedAt: Date,
): Promise<void> {
    if (!isDatabaseAvailable()) return;
    const start = parseIsoDate(state.startDate || '');
    const end = parseIsoDate(state.endDate || '', true);
    if (!start || !end) return;

    await LoaRequestModel.findOneAndUpdate(
        { pendingId },
        {
            $set: {
                guildId: interaction.guildId || '',
                userId: interaction.user.id,
                memberUsername: interaction.user.username,
                name,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                reason,
                requestedAt,
                channelId,
                messageId,
                status: 'Pending',
                updatedAt: requestedAt,
            },
            $setOnInsert: {
                createdAt: requestedAt,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
}

async function submitCalendarRequest(interaction: ModalSubmitInteraction): Promise<boolean> {
    const state = getState(interaction);
    if (!state?.startDate || !state.endDate || !interaction.guildId) {
        await interaction.reply({
            content: 'Your LOA date-selection session expired. Run `/loa request` again and choose the dates first.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const start = parseIsoDate(state.startDate);
    const end = parseIsoDate(state.endDate, true);
    if (!start || !end || end.getTime() < start.getTime()) {
        await interaction.reply({
            content: 'Those dates are no longer valid. Run `/loa request` again and choose the start/end dates.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const name = interaction.fields.getTextInputValue('name').trim();
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!name || !reason) {
        await interaction.editReply('Your name and LOA reason are required.');
        return true;
    }

    const channel = await interaction.client.channels.fetch(LOA_REVIEW_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        await interaction.editReply(`The LOA review channel <#${LOA_REVIEW_CHANNEL_ID}> is unavailable. Please contact management.`);
        return true;
    }

    const pendingId = `${interaction.user.id}-${Date.now()}`;
    const requestedAt = new Date();
    const message = await channel.send(legacyEmbedToV2Message(
        requestEmbed(
            interaction.user.id,
            name,
            state.startDate,
            state.endDate,
            reason,
            requestedAt,
        ),
        {
            content: `<@${interaction.user.id}>`,
            actionRows: reviewRows(pendingId),
            allowedMentions: { parse: [], users: [interaction.user.id] },
        },
    ));

    await persistRequest(
        pendingId,
        interaction,
        name,
        reason,
        state,
        channel.id,
        message.id,
        requestedAt,
    ).catch(error => {
        logger.warn(`[LOA] Calendar request ${pendingId} will use Discord recovery because database save failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    states.delete(stateKey(state.guildId, state.userId));
    await interaction.editReply(
        `✅ Your LOA request has been submitted for review.\n**Start:** ${friendlyDate(state.startDate)}\n**End:** ${friendlyDate(state.endDate)}`,
    );
    return true;
}

async function handleCalendarButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'loa:request:open') {
        await beginCalendar(interaction);
        return true;
    }
    if (!interaction.customId.startsWith('loa:calendar:')) return false;

    const state = getState(interaction);
    if (!state) {
        if (interaction.customId === 'loa:calendar:cancel') {
            await interaction.update({ content: 'LOA request cancelled.', components: [] });
        } else {
            await interaction.update({
                content: 'This LOA calendar expired. Run `/loa request` again.',
                components: [],
            });
        }
        return true;
    }

    if (interaction.customId === 'loa:calendar:cancel') {
        states.delete(stateKey(state.guildId, state.userId));
        await interaction.update({ content: 'LOA request cancelled.', components: [] });
        return true;
    }

    if (interaction.customId === 'loa:calendar:continue') {
        if (!state.startDate || !state.endDate) {
            await interaction.reply({ content: 'Choose both dates first.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(detailsModal());
        return true;
    }

    const editMatch = interaction.customId.match(/^loa:calendar:edit:(start|end)$/u);
    if (editMatch) {
        const mode = editMatch[1] as 'start' | 'end';
        await interaction.update({
            content: calendarContent(state, mode, 0),
            components: calendarRows(state, mode, 0),
        });
        return true;
    }

    const pageMatch = interaction.customId.match(/^loa:calendar:page:(start|end):(\d+)$/u);
    if (pageMatch) {
        const mode = pageMatch[1] as 'start' | 'end';
        const page = Math.max(0, Math.min(MAX_PAGE, Number(pageMatch[2])));
        await interaction.update({
            content: calendarContent(state, mode, page),
            components: calendarRows(state, mode, page),
        });
        return true;
    }

    const pickMatch = interaction.customId.match(/^loa:calendar:pick:(start|end):(\d{4}-\d{2}-\d{2})$/u);
    if (pickMatch) {
        const mode = pickMatch[1] as 'start' | 'end';
        const value = pickMatch[2];
        const picked = parseIsoDate(value);
        if (!picked) {
            await interaction.reply({ content: 'That date is invalid. Please choose another date.', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (mode === 'start') {
            if (picked.getTime() < todayUtc().getTime()) {
                await interaction.reply({ content: 'The start date cannot be in the past.', flags: MessageFlags.Ephemeral });
                return true;
            }
            state.startDate = value;
            if (state.endDate) {
                const currentEnd = parseIsoDate(state.endDate, true);
                if (!currentEnd || currentEnd.getTime() < picked.getTime()) state.endDate = undefined;
            }
            await interaction.update({
                content: calendarContent(state, 'end', 0),
                components: calendarRows(state, 'end', 0),
            });
            return true;
        }

        if (!state.startDate) {
            await interaction.update({
                content: calendarContent(state, 'start', 0),
                components: calendarRows(state, 'start', 0),
            });
            return true;
        }
        const start = parseIsoDate(state.startDate);
        if (!start || picked.getTime() < start.getTime()) {
            await interaction.reply({ content: 'The end date cannot be before the start date.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.endDate = value;
        await interaction.update(summaryPayload(state));
        return true;
    }

    return false;
}

export function registerLoaCalendarRequest(): void {
    if (installed) return;
    installed = true;

    const loaModule = require('../commands/loa.ts') as LoaModule;
    const previousButton = loaModule.handleLoaButton.bind(loaModule);
    const previousModal = loaModule.handleLoaModal.bind(loaModule);
    const previousExecute = loaModule.loaCommand.execute.bind(loaModule.loaCommand);

    loaModule.handleLoaButton = async (interaction: ButtonInteraction): Promise<boolean> => {
        if (interaction.customId === 'loa:request:open' || interaction.customId.startsWith('loa:calendar:')) {
            return handleCalendarButton(interaction);
        }
        return previousButton(interaction);
    };

    loaModule.handleLoaModal = async (interaction: ModalSubmitInteraction): Promise<boolean> => {
        if (interaction.customId === 'loa:calendar:details') return submitCalendarRequest(interaction);
        return previousModal(interaction);
    };

    loaModule.loaCommand.execute = async (interaction: ChatInputCommandInteraction): Promise<void> => {
        let subcommand = '';
        try {
            subcommand = interaction.options.getSubcommand();
        } catch {
            // Delegate malformed/legacy invocations to the original command.
        }
        if (subcommand !== 'request') {
            await previousExecute(interaction);
            return;
        }
        await beginCalendar(interaction);
    };

    // If the registry was already loaded by another startup path, replace its
    // cached /loa handler too. Normally the registry is warmed after this hook.
    try {
        const registryPath = require.resolve('../commands/registry.ts');
        if (require.cache[registryPath]) {
            const registry = require('../commands/registry.ts') as {
                commandHandlers?: Map<string, (interaction: ChatInputCommandInteraction) => Promise<unknown>>;
            };
            registry.commandHandlers?.set('loa', loaModule.loaCommand.execute);
        }
    } catch {
        // The registry has not been loaded yet, which is the normal path.
    }

    logger.info('[LOA] Calendar-style start/end date picker installed.');
}
