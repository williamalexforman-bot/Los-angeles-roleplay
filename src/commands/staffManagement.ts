import { resolve } from 'path';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    ThreadAutoArchiveDuration,
    type SendableChannels,
    type ThreadChannel,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { logger } from '../utils/logger';

const BRAND_COLOR = 0x3b82f6;
const PASS_COLOR = 0x22c55e;
const FAIL_COLOR = 0xef4444;
const BRAND_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
const LOGO_NAME = 'larp-logo.png';
const LOGO_PATH = resolve(__dirname, '..', '..', 'assets', LOGO_NAME);

const TRAINING_RESULTS_CHANNEL_ID = process.env.TRAINING_RESULTS_CHANNEL_ID || '1526490481398124614';
const PROMOTIONS_CHANNEL_ID = process.env.PROMOTIONS_CHANNEL_ID || '1526044978109743255';
const INFRACTION_PARENT_CHANNEL_ID = process.env.INFRACTION_PARENT_CHANNEL_ID || '1526044664975851642';

const INFRACTION_ACTIONS = [
    'Verbal Warning',
    'Warning',
    'Strike',
    'Suspension',
    'Demotion',
    'Termination',
    'Under Investigation',
    'Blacklist',
] as const;

type InfractionAction = (typeof INFRACTION_ACTIONS)[number];
export type InfractionStatus = 'Active' | 'Voided' | 'Closed';

export interface InfractionHistoryEntry {
    action: string;
    actorId: string;
    details: string;
    timestamp: string;
}

export interface InfractionRecord {
    caseNumber: string;
    guildId: string;
    memberId: string;
    memberUsername: string;
    issuedById: string;
    action: InfractionAction;
    reason: string;
    ruleBroken: string;
    evidence: string;
    internalNotes: string;
    notifyMember: boolean;
    expiration: string;
    status: InfractionStatus;
    parentChannelId: string;
    headerMessageId: string;
    threadId: string;
    detailMessageId: string;
    createdAt: string;
    updatedAt: string;
    history: InfractionHistoryEntry[];
}

export interface InfractionPersistenceAdapter {
    /** Use an atomic database counter in production. */
    nextCaseNumber?: (guildId: string) => Promise<number | string>;
    /** This callback should upsert the complete record, including threadId and history. */
    saveInfraction: (record: InfractionRecord) => Promise<void>;
    /** Required for persistent button handling after a process restart. */
    getInfractionByThreadId?: (threadId: string) => Promise<InfractionRecord | null>;
}

type InfractionAuthorizationHandler = (
    interaction: ButtonInteraction | ModalSubmitInteraction,
    record: InfractionRecord,
) => boolean | Promise<boolean>;

let persistenceAdapter: InfractionPersistenceAdapter | null = null;
let authorizationHandler: InfractionAuthorizationHandler | null = null;
let localCaseSequence = 0;
const inMemoryInfractions = new Map<string, InfractionRecord>();

export function configureInfractionPersistence(adapter: InfractionPersistenceAdapter | null): void {
    persistenceAdapter = adapter;
}

export function configureInfractionAuthorization(handler: InfractionAuthorizationHandler | null): void {
    authorizationHandler = handler;
}

function logoAttachment() {
    return { attachment: LOGO_PATH, name: LOGO_NAME };
}

function brandedEmbed(title: string, color = BRAND_COLOR): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(`attachment://${LOGO_NAME}`)
        .setFooter({ text: BRAND_FOOTER })
        .setTimestamp();
}

async function getSendableChannel(
    interaction: ChatInputCommandInteraction,
    channelId: string,
): Promise<SendableChannels | null> {
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

function discordTimestamp(date: Date = new Date()): string {
    return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function sanitizeThreadSegment(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 28) || 'Member';
}

async function nextInfractionCaseNumber(guildId: string): Promise<string> {
    let next: number | string;

    if (persistenceAdapter?.nextCaseNumber) {
        try {
            next = await persistenceAdapter.nextCaseNumber(guildId);
        } catch (error) {
            console.error('[Infractions] Unable to reserve a database case number; using a process-local number.', error);
            next = ++localCaseSequence;
        }
    } else {
        next = ++localCaseSequence;
    }

    if (typeof next === 'number') return `INF-${String(next).padStart(4, '0')}`;
    if (/^INF-/i.test(next)) return next.toUpperCase();
    if (/^\d+$/.test(next)) return `INF-${next.padStart(4, '0')}`;
    return `INF-${next}`.slice(0, 24);
}

function addHistory(record: InfractionRecord, action: string, actorId: string, details: string): void {
    const timestamp = new Date().toISOString();
    record.updatedAt = timestamp;
    record.history.push({ action, actorId, details, timestamp });
}

async function persistRecord(record: InfractionRecord): Promise<boolean> {
    inMemoryInfractions.set(record.threadId, record);
    if (!persistenceAdapter) return false;

    try {
        await persistenceAdapter.saveInfraction(record);
        return true;
    } catch (error) {
        console.error(`[Infractions] Unable to persist ${record.caseNumber}.`, error);
        return false;
    }
}

async function getInfractionRecord(threadId: string): Promise<InfractionRecord | null> {
    const localRecord = inMemoryInfractions.get(threadId);
    if (localRecord) return localRecord;
    if (!persistenceAdapter?.getInfractionByThreadId) return null;

    try {
        const record = await persistenceAdapter.getInfractionByThreadId(threadId);
        if (record) inMemoryInfractions.set(threadId, record);
        return record;
    } catch (error) {
        console.error('[Infractions] Unable to load the infraction record.', error);
        return null;
    }
}

function buildInfractionEmbed(record: InfractionRecord): EmbedBuilder {
    return brandedEmbed(`Staff Infraction | ${record.caseNumber}`)
        .setDescription(
            'The high ranking team at Los Angeles Roleplay has issued you an infraction. '
            + 'Open the linked evidence thread to upload screenshots, recordings, links, and other supporting material.',
        )
        .addFields(
            { name: 'Member', value: `<@${record.memberId}>`, inline: true },
            { name: 'Action', value: record.action, inline: true },
            { name: 'Status', value: record.status, inline: true },
            { name: 'Reason', value: record.reason },
            { name: 'Notes', value: record.ruleBroken },
            { name: 'Evidence', value: record.evidence || 'No evidence supplied.' },
            { name: 'Internal Notes', value: record.internalNotes || 'No internal notes supplied.' },
            { name: 'Expiration', value: record.expiration || 'No expiration set.', inline: true },
            { name: 'Direct Message', value: record.notifyMember ? 'Requested' : 'Not requested', inline: true },
            { name: 'Issued By', value: `<@${record.issuedById}>`, inline: true },
            { name: 'Created', value: discordTimestamp(new Date(record.createdAt)) },
        );
}

function infractionControls(
    status: InfractionStatus,
    threadId: string,
    threadUrl: string,
): ActionRowBuilder<ButtonBuilder>[] {
    const inactive = status !== 'Active';
    const closed = status === 'Closed';
    const controlId = (action: string) => `infraction:${action}:${threadId}`;

    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(controlId('edit')).setLabel('Edit').setStyle(ButtonStyle.Primary).setDisabled(inactive),
        new ButtonBuilder()
            .setCustomId(controlId('add-evidence'))
            .setLabel('Add Evidence')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(inactive),
        new ButtonBuilder()
            .setCustomId(controlId('add-note'))
            .setLabel('Add Note')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(inactive),
        new ButtonBuilder().setCustomId(controlId('void')).setLabel('Void').setStyle(ButtonStyle.Danger).setDisabled(inactive),
        new ButtonBuilder().setCustomId(controlId('history')).setLabel('View History').setStyle(ButtonStyle.Secondary),
    );

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Evidence Thread')
            .setStyle(ButtonStyle.Link)
            .setURL(threadUrl),
        new ButtonBuilder()
            .setCustomId(controlId('close'))
            .setLabel('Close Thread')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(closed),
    );

    return [primaryRow, closeRow];
}

async function updateInfractionDetailMessage(thread: ThreadChannel, record: InfractionRecord): Promise<void> {
    if (!record.detailMessageId) return;
    const parent = await thread.client.channels.fetch(record.parentChannelId).catch(() => null);
    let message = parent instanceof TextChannel
        ? await parent.messages.fetch(record.detailMessageId).catch(() => null)
        : null;
    // Compatibility for cases created before the record embed moved to the parent channel.
    if (!message) message = await thread.messages.fetch(record.detailMessageId).catch(() => null);
    if (!message) return;
    await message.edit({
        embeds: [buildInfractionEmbed(record)],
        components: infractionControls(record.status, record.threadId, thread.url),
    });
}

async function resolveInfractionThread(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    record: InfractionRecord,
): Promise<ThreadChannel | null> {
    if (interaction.channel?.isThread() && interaction.channel.id === record.threadId) return interaction.channel;
    const fetched = await interaction.client.channels.fetch(record.threadId).catch(() => null);
    return fetched?.isThread() ? fetched : null;
}

function trainingResultCommand() {
    return {
        data: new SlashCommandBuilder()
            .setName('training-results')
            .setDescription('Publish a completed staff training result')
            .addUserOption(option => option.setName('trainee').setDescription('The trainee being evaluated').setRequired(true))
            .addUserOption(option => option.setName('trainer').setDescription('The trainer conducting the evaluation').setRequired(true))
            .addStringOption(option =>
                option.setName('department').setDescription('The department for this training').setRequired(true).setMaxLength(100),
            )
            .addIntegerOption(option =>
                option.setName('driving-score').setDescription('Driving score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10),
            )
            .addIntegerOption(option =>
                option.setName('spag-score').setDescription('SPaG score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10),
            )
            .addIntegerOption(option =>
                option.setName('mod-calls-score').setDescription('Mod calls score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10),
            )
            .addIntegerOption(option =>
                option.setName('communication-score').setDescription('Communication score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10),
            )
            .addIntegerOption(option =>
                option.setName('professionalism-score').setDescription('Professionalism score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10),
            )
            .addStringOption(option =>
                option
                    .setName('result')
                    .setDescription('The final training result')
                    .setRequired(true)
                    .addChoices({ name: 'Pass', value: 'Pass' }, { name: 'Fail', value: 'Fail' }),
            )
            .addStringOption(option => option.setName('notes').setDescription('Additional training notes').setMaxLength(1024)),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const trainee = interaction.options.getUser('trainee', true);
                const trainer = interaction.options.getUser('trainer', true);
                const department = interaction.options.getString('department', true);
                const driving = interaction.options.getInteger('driving-score', true);
                const spag = interaction.options.getInteger('spag-score', true);
                const modCalls = interaction.options.getInteger('mod-calls-score', true);
                const communication = interaction.options.getInteger('communication-score', true);
                const professionalism = interaction.options.getInteger('professionalism-score', true);
                const result = interaction.options.getString('result', true) as 'Pass' | 'Fail';
                const notes = interaction.options.getString('notes') || 'No additional notes supplied.';
                const destination = await getSendableChannel(interaction, TRAINING_RESULTS_CHANNEL_ID);

                if (!destination) {
                    await interaction.editReply('The training-results channel is unavailable. Please contact an administrator.');
                    return;
                }

                const average = (driving + spag + modCalls + communication + professionalism) / 5;
                const embed = brandedEmbed(
                    `${result === 'Pass' ? '✅' : '❌'} Training Result | ${result}`,
                    result === 'Pass' ? PASS_COLOR : FAIL_COLOR,
                ).addFields(
                    { name: 'Trainee', value: `<@${trainee.id}>`, inline: true },
                    { name: 'Trainer', value: `<@${trainer.id}>`, inline: true },
                    { name: 'Department', value: department, inline: true },
                    { name: 'Driving', value: `${driving}/10`, inline: true },
                    { name: 'SPaG', value: `${spag}/10`, inline: true },
                    { name: 'Mod Calls', value: `${modCalls}/10`, inline: true },
                    { name: 'Communication', value: `${communication}/10`, inline: true },
                    { name: 'Professionalism', value: `${professionalism}/10`, inline: true },
                    { name: 'Average', value: `${average.toFixed(1)}/10`, inline: true },
                    { name: 'Result', value: result, inline: true },
                    { name: 'Notes', value: notes },
                    { name: 'Submitted', value: discordTimestamp() },
                );

                await destination.send({
                    content: `<@${trainee.id}> — Training Result`,
                    embeds: [embed],
                    files: [logoAttachment()],
                    allowedMentions: { users: [trainee.id], parse: [] },
                });
                await interaction.editReply('The training result has been published successfully.');
            } catch (error) {
                console.error('[Staff Management] Training result submission failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to publish the training result right now. Please try again later.');
            }
        },
    };
}

function promotionCommand() {
    return {
        data: new SlashCommandBuilder()
            .setName('promotion')
            .setDescription('Manage staff promotions')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('issue')
                    .setDescription('Issue and publish a staff promotion')
                    .addUserOption(option => option.setName('member').setDescription('The member being promoted').setRequired(true))
                    .addRoleOption(option => option.setName('old-rank').setDescription('The member\'s current rank').setRequired(true))
                    .addRoleOption(option => option.setName('new-role').setDescription('The new server role for this promotion').setRequired(true))
                    .addStringOption(option => option.setName('reason').setDescription('The reason for the promotion').setRequired(true).setMaxLength(1024))
                    .addUserOption(option => option.setName('approved-by').setDescription('The person who approved the promotion').setRequired(true))
                    .addStringOption(option => option.setName('effective-date').setDescription('The date the promotion takes effect').setRequired(true).setMaxLength(100)),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                interaction.options.getSubcommand(true);
                const member = interaction.options.getUser('member', true);
                const oldRankRole = interaction.options.getRole('old-rank', true);
                const newRole = interaction.options.getRole('new-role', true);
                const reason = interaction.options.getString('reason', true);
                const approvedBy = interaction.options.getUser('approved-by', true);
                const effectiveDate = interaction.options.getString('effective-date', true);
                const destination = await getSendableChannel(interaction, PROMOTIONS_CHANNEL_ID);

                if (!destination) {
                    await interaction.editReply('The promotions channel is unavailable. Please contact an administrator.');
                    return;
                }

                const embed = brandedEmbed('🎖️ Staff Promotion')
                    .setDescription('The high ranking team at Los Angeles Roleplay has issued you a promotion.')
                    .addFields(
                    { name: 'Member', value: `<@${member.id}>`, inline: true },
                    { name: 'Old Rank', value: `<@&${oldRankRole.id}>`, inline: true },
                    { name: 'New Role', value: `<@&${newRole.id}>`, inline: true },
                    { name: 'Reason', value: reason },
                    { name: 'Approved By', value: `<@${approvedBy.id}>`, inline: true },
                    { name: 'Effective Date', value: effectiveDate, inline: true },
                    { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Submitted', value: discordTimestamp() },
                );

                await destination.send({
                    content: `🎉 Congratulations <@${member.id}>! You have been promoted to <@&${newRole.id}>.`,
                    embeds: [embed],
                    files: [logoAttachment()],
                    allowedMentions: { parse: [], users: [member.id] },
                });

                // Send DM to the promoted member
                const dmEmbed = brandedEmbed('🎖️ You Have Been Promoted!')
                    .setDescription('Congratulations! The high ranking team at Los Angeles Roleplay has issued you a promotion.')
                    .addFields(
                        { name: 'New Role', value: `<@&${newRole.id}>`, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Approved By', value: `<@${approvedBy.id}>`, inline: true },
                        { name: 'Effective Date', value: effectiveDate, inline: true },
                        { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
                    );
                await member.send({ embeds: [dmEmbed], files: [logoAttachment()] }).catch(() => {
                    logger.warn(`Could not send promotion DM to ${member.tag} (${member.id}).`);
                });

                await interaction.editReply(`The promotion for ${member.username} has been published successfully.`);
            } catch (error) {
                console.error('[Staff Management] Promotion submission failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to publish the promotion right now. Please try again later.');
            }
        },
    };
}

function infractionCommand() {
    return {
        data: new SlashCommandBuilder()
            .setName('infraction')
            .setDescription('Manage professional staff infraction cases')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('issue')
                    .setDescription('Issue a new staff infraction')
                    .addUserOption(option => option.setName('member').setDescription('The member receiving the infraction').setRequired(true))
                    .addStringOption(option =>
                        option
                            .setName('action')
                            .setDescription('The infraction action')
                            .setRequired(true)
                            .addChoices(...INFRACTION_ACTIONS.map(action => ({ name: action, value: action }))),
                    )
                    .addStringOption(option => option.setName('reason').setDescription('The reason for this infraction').setRequired(true).setMaxLength(1024))
                    .addStringOption(option => option.setName('notes').setDescription('Notes for this infraction').setRequired(true).setMaxLength(1024))
                    .addStringOption(option => option.setName('evidence').setDescription('Evidence link or supporting information').setMaxLength(1024))
                    .addStringOption(option => option.setName('internal-notes').setDescription('Private notes for authorized staff').setMaxLength(1024))
                    .addBooleanOption(option => option.setName('notify-member').setDescription('Also notify the member by direct message'))
                    .addStringOption(option => option.setName('expiration').setDescription('When this infraction expires, if applicable').setMaxLength(100)),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                interaction.options.getSubcommand(true);
                if (!interaction.guildId) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                const member = interaction.options.getUser('member', true);
                const action = interaction.options.getString('action', true) as InfractionAction;
                const reason = interaction.options.getString('reason', true);
                const ruleBroken = interaction.options.getString('notes', true);
                const evidence = interaction.options.getString('evidence') || 'No evidence supplied.';
                const internalNotes = interaction.options.getString('internal-notes') || 'No internal notes supplied.';
                const notifyMember = interaction.options.getBoolean('notify-member') ?? false;
                const expiration = interaction.options.getString('expiration') || 'No expiration set.';
                const caseNumber = await nextInfractionCaseNumber(interaction.guildId);

                const fetchedParent = await interaction.client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
                if (!(fetchedParent instanceof TextChannel) || fetchedParent.type !== ChannelType.GuildText) {
                    await interaction.editReply('The configured infraction parent channel is unavailable or is not a standard text channel.');
                    return;
                }

                const now = new Date().toISOString();
                const record: InfractionRecord = {
                    caseNumber,
                    guildId: interaction.guildId,
                    memberId: member.id,
                    memberUsername: member.username,
                    issuedById: interaction.user.id,
                    action,
                    reason,
                    ruleBroken,
                    evidence,
                    internalNotes,
                    notifyMember,
                    expiration,
                    status: 'Active',
                    parentChannelId: fetchedParent.id,
                    headerMessageId: '',
                    threadId: '',
                    detailMessageId: '',
                    createdAt: now,
                    updatedAt: now,
                    history: [],
                };
                addHistory(record, 'Created', interaction.user.id, `${action} issued to ${member.username}.`);

                let detailMessage;
                try {
                    detailMessage = await fetchedParent.send({
                        content: `<@${member.id}>, a staff infraction has been issued. Please review the record below.`,
                        embeds: [buildInfractionEmbed(record)],
                        files: [logoAttachment()],
                        allowedMentions: { parse: [], users: [member.id] },
                    });
                } catch (error) { throw error; }
                record.headerMessageId = detailMessage.id;
                record.detailMessageId = detailMessage.id;

                let thread: ThreadChannel;
                try {
                    thread = await detailMessage.startThread({
                        name: `${caseNumber} | ${sanitizeThreadSegment(member.username)} | ${action}`.slice(0, 100),
                        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                        reason: `${caseNumber} issued by ${interaction.user.id}`,
                    });
                    record.threadId = thread.id;
                    await detailMessage.edit({
                        embeds: [buildInfractionEmbed(record)],
                        components: infractionControls(record.status, thread.id, thread.url),
                    });
                } catch (error) {
                    await detailMessage.delete().catch(() => null);
                    throw error;
                }

                await thread.send({
                    content: `**Evidence Workspace | ${caseNumber}**\nUpload screenshots, recordings, files, and links in this thread. The complete infraction record and management controls are in ${detailMessage.url}.`,
                    allowedMentions: { parse: [] },
                }).catch(() => null);

                let memberNotified = !notifyMember;
                if (notifyMember) {
                    const notificationEmbed = brandedEmbed(`Staff Infraction | ${caseNumber}`)
                        .setDescription('The high ranking team at Los Angeles Roleplay has issued you an infraction.')
                        .addFields(
                        { name: 'Action', value: action, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Rule Broken', value: ruleBroken },
                        { name: 'Expiration', value: expiration },
                        { name: 'Evidence Thread', value: thread ? thread.url : 'Not available' },
                    );
                    memberNotified = await member
                        .send({ embeds: [notificationEmbed], files: [logoAttachment()] })
                        .then(() => true)
                        .catch(() => false);
                    addHistory(
                        record,
                        memberNotified ? 'Member Notified' : 'Notification Failed',
                        interaction.user.id,
                        memberNotified ? 'The member was notified by direct message.' : 'The member could not be reached by direct message.',
                    );
                }

                const persisted = await persistRecord(record);
                if (!memberNotified) {
                    await thread.send('The member could not be notified by direct message.');
                }
                if (!persisted) {
                    await thread.send('Database persistence is currently unavailable. The case remains active in this process only.');
                }

                await interaction.editReply(
                    `${caseNumber} was created successfully: ${detailMessage.url}`
                    + `${persisted ? '' : '\nWarning: database persistence is unavailable.'}`,
                );
            } catch (error) {
                console.error('[Staff Management] Infraction creation failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to create the infraction case right now. Please verify the bot permissions and try again.');
            }
        },
    };
}

async function isAuthorized(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    record: InfractionRecord,
): Promise<boolean> {
    if (authorizationHandler) return authorizationHandler(interaction, record);
    if (interaction.user.id === record.issuedById) return true;
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads),
    );
}

async function rejectUnauthorized(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    const content = 'You do not have permission to manage this infraction.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function textInput(
    customId: string,
    label: string,
    style: TextInputStyle,
    required: boolean,
    value?: string,
): TextInputBuilder {
    const input = new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setMaxLength(style === TextInputStyle.Short ? 100 : 1024);
    if (value && !value.startsWith('No ')) input.setValue(value.slice(0, style === TextInputStyle.Short ? 100 : 1024));
    return input;
}

function modalRow(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function editInfractionModal(threadId: string, record?: InfractionRecord): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction:edit-modal:${threadId}`)
        .setTitle(record ? `Edit ${record.caseNumber}` : 'Edit Infraction')
        .addComponents(
            modalRow(textInput('reason', 'Reason', TextInputStyle.Paragraph, true, record?.reason)),
            modalRow(textInput('notes', 'Notes', TextInputStyle.Paragraph, true, record?.ruleBroken)),
            modalRow(textInput('evidence', 'Evidence', TextInputStyle.Paragraph, false, record?.evidence)),
            modalRow(textInput('internal-notes', 'Internal Notes', TextInputStyle.Paragraph, false, record?.internalNotes)),
            modalRow(textInput('expiration', 'Expiration', TextInputStyle.Short, false, record?.expiration)),
        );
}

function singleInputModal(
    customId: string,
    title: string,
    inputId: string,
    label: string,
    style = TextInputStyle.Paragraph,
): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(modalRow(textInput(inputId, label, style, true)));
}

async function threadEventEmbed(thread: ThreadChannel, title: string, description: string): Promise<void> {
    await thread.send({
        embeds: [brandedEmbed(title).setDescription(description)],
        files: [logoAttachment()],
        allowedMentions: { parse: [] },
    });
}

/**
 * Routes the infraction controls. Returns false when the custom ID belongs to another feature.
 */
export async function handleStaffManagementButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction:')) return false;

    const [, action, encodedThreadId] = interaction.customId.split(':');
    const targetThreadId = /^\d{17,20}$/.test(encodedThreadId || '')
        ? encodedThreadId
        : interaction.channelId;

    // Modal-opening button interactions must be acknowledged immediately. Authorization
    // and record status are revalidated when the modal is submitted.
    switch (action) {
        case 'edit':
            await interaction.showModal(editInfractionModal(
                targetThreadId,
                inMemoryInfractions.get(targetThreadId),
            ));
            return true;
        case 'add-evidence':
            await interaction.showModal(singleInputModal(
                `infraction:evidence-modal:${targetThreadId}`,
                'Add Infraction Evidence',
                'evidence',
                'Evidence or Link',
            ));
            return true;
        case 'add-note':
            await interaction.showModal(singleInputModal(
                `infraction:note-modal:${targetThreadId}`,
                'Add Infraction Note',
                'note',
                'Internal Note',
            ));
            return true;
        case 'void':
            await interaction.showModal(singleInputModal(
                `infraction:void-modal:${targetThreadId}`,
                'Void Infraction',
                'void-reason',
                'Reason for Voiding',
            ));
            return true;
        default:
            break;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const record = await getInfractionRecord(targetThreadId);
    if (!record) {
        await interaction.editReply('This infraction record could not be loaded.');
        return true;
    }
    if (!(await isAuthorized(interaction, record))) {
        await rejectUnauthorized(interaction);
        return true;
    }

    switch (action) {
        case 'history': {
            const history = record.history
                .slice(-15)
                .map(entry => {
                    const timestamp = Math.floor(new Date(entry.timestamp).getTime() / 1000);
                    return `• <t:${timestamp}:f> — **${entry.action}** by <@${entry.actorId}>\n${entry.details}`;
                })
                .join('\n');
            await interaction.editReply({
                content: history.slice(0, 1900) || 'No history is available for this infraction.',
                allowedMentions: { parse: [] },
            });
            return true;
        }

        case 'close': {
            const thread = await resolveInfractionThread(interaction, record);
            if (!thread) {
                await interaction.editReply('The evidence thread for this infraction is unavailable.');
                return true;
            }
            addHistory(record, 'Thread Closed', interaction.user.id, 'The infraction thread was closed and locked.');
            // Archiving a voided case must not erase its durable Voided audit status.
            if (record.status !== 'Voided') record.status = 'Closed';
            {
                const persisted = await persistRecord(record);
                await updateInfractionDetailMessage(thread, record);
                await interaction.editReply(
                    `${record.caseNumber} is being closed.${persisted ? '' : '\nWarning: database persistence is unavailable; the update is retained only until this process restarts.'}`,
                );
            }
            await threadEventEmbed(thread, `Case Closed | ${record.caseNumber}`, `Closed by <@${interaction.user.id}>.`);
            await thread.edit({ archived: true, locked: true, reason: `${record.caseNumber} closed by ${interaction.user.id}` });
            return true;
        }

        default:
            return false;
    }
}

/**
 * Routes modals opened by the infraction controls. Returns false for unrelated modal submissions.
 */
export async function handleStaffManagementModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('infraction:')) return false;

    const parts = interaction.customId.split(':');
    const modalType = parts[1];
    const threadId = parts[2];
    if (!threadId) {
        await interaction.reply({ content: 'This infraction modal is no longer valid in this channel.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const record = await getInfractionRecord(threadId);
    if (!record) {
        await interaction.editReply('This infraction record could not be loaded.');
        return true;
    }
    if (interaction.channelId !== record.parentChannelId && interaction.channelId !== record.threadId) {
        await interaction.editReply('This infraction modal is no longer valid in this channel.');
        return true;
    }
    if (!(await isAuthorized(interaction, record))) {
        await rejectUnauthorized(interaction);
        return true;
    }
    if (record.status !== 'Active') {
        await interaction.editReply('This infraction is no longer active.');
        return true;
    }

    const thread = await resolveInfractionThread(interaction, record);
    if (!thread) {
        await interaction.editReply('The evidence thread for this infraction is unavailable.');
        return true;
    }

    try {
        switch (modalType) {
            case 'edit-modal': {
                record.reason = interaction.fields.getTextInputValue('reason');
                record.ruleBroken = interaction.fields.getTextInputValue('notes');
                record.evidence = interaction.fields.getTextInputValue('evidence') || 'No evidence supplied.';
                record.internalNotes = interaction.fields.getTextInputValue('internal-notes') || 'No internal notes supplied.';
                record.expiration = interaction.fields.getTextInputValue('expiration') || 'No expiration set.';
                addHistory(record, 'Edited', interaction.user.id, 'The core infraction details were updated.');
                const persisted = await persistRecord(record);
                await updateInfractionDetailMessage(thread, record);
                await threadEventEmbed(thread, `Case Updated | ${record.caseNumber}`, `Updated by <@${interaction.user.id}>.`);
                await interaction.editReply(
                    `${record.caseNumber} was updated.${persisted ? '' : '\nWarning: database persistence is unavailable; the update is retained only until this process restarts.'}`,
                );
                return true;
            }

            case 'evidence-modal': {
                const evidence = interaction.fields.getTextInputValue('evidence');
                addHistory(record, 'Evidence Added', interaction.user.id, evidence);
                const persisted = await persistRecord(record);
                await threadEventEmbed(
                    thread,
                    `Evidence Added | ${record.caseNumber}`,
                    `**Added By:** <@${interaction.user.id}>\n\n${evidence}`,
                );
                await interaction.editReply(
                    `Evidence was added to ${record.caseNumber}.${persisted ? '' : '\nWarning: database persistence is unavailable; the update is retained only until this process restarts.'}`,
                );
                return true;
            }

            case 'note-modal': {
                const note = interaction.fields.getTextInputValue('note');
                addHistory(record, 'Note Added', interaction.user.id, note);
                const persisted = await persistRecord(record);
                await threadEventEmbed(
                    thread,
                    `Internal Note | ${record.caseNumber}`,
                    `**Added By:** <@${interaction.user.id}>\n\n${note}`,
                );
                await interaction.editReply(
                    `An internal note was added to ${record.caseNumber}.${persisted ? '' : '\nWarning: database persistence is unavailable; the update is retained only until this process restarts.'}`,
                );
                return true;
            }

            case 'void-modal': {
                const voidReason = interaction.fields.getTextInputValue('void-reason');
                record.status = 'Voided';
                addHistory(record, 'Voided', interaction.user.id, voidReason);
                const persisted = await persistRecord(record);
                await updateInfractionDetailMessage(thread, record);
                await threadEventEmbed(
                    thread,
                    `Case Voided | ${record.caseNumber}`,
                    `**Voided By:** <@${interaction.user.id}>\n**Reason:** ${voidReason}\n\nThe record has been preserved for audit history.`,
                );
                await interaction.editReply(
                    `${record.caseNumber} was voided. Its audit history has been preserved.${persisted ? '' : '\nWarning: database persistence is unavailable; the update is retained only until this process restarts.'}`,
                );
                return true;
            }

            default:
                await interaction.editReply('Unknown infraction action.');
                return true;
        }
    } catch (error) {
        console.error(`[Infractions] Unable to process ${modalType}.`, error);
        await interaction.editReply('Unable to update this infraction right now. Please try again later.');
        return true;
    }
}

export const staffManagementCommands = [trainingResultCommand(), promotionCommand(), infractionCommand()];
