import { resolve } from 'path';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    ContainerBuilder,
    EmbedBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    Role,
    SeparatorBuilder,
    SlashCommandBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    TextDisplayBuilder,
    ThreadAutoArchiveDuration,
    type SendableChannels,
    type ThreadChannel,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { bannerFiles, bannerUrl, underbannerEmbed } from '../utils/bannerAssets';
import { CHANNEL_IDS } from '../config/constants';
import {
    applyTemplate, configuredChannelId, getGuildBotConfig, getPanelBannerUrl, getPanelConfig,
    parseEmojiMap, saveGuildBotConfig, type ConfigRoleKey, type PanelConfig,
} from '../services/panelConfig';
import { embedsToV2 } from '../utils/componentsV2';

const BRAND_COLOR = 0xfacc15;
const PASS_COLOR = 0x22c55e;
const FAIL_COLOR = 0xef4444;
const BRAND_FOOTER = 'California State Roleplay | Realism at its Finest';
const INFRACTION_TOP_BANNER = 'https://cdn.phototourl.com/member/2026-10-01-60ce2bbe-ee05-4f4e-99fc-aaa8486c2df4.webp';
const PROMOTION_TOP_BANNER = 'https://cdn.phototourl.com/member/2026-10-01-06f689fa-5eb8-451a-a0a0-3731a60719e1.webp';
const STAFF_RECORD_UNDERBANNER = 'https://cdn.phototourl.com/member/2026-10-01-bff4de21-36e5-4cb3-9500-7f3ecb2862e2.webp';
const WARN_EMOJI = '<:Warn:1525234084194943148>';
const ARROW_EMOJI = '<:arrow2:1517010011258228786>';
const PROMOTION_EMOJI = '<:Giveaway:1516784210642341959>';
const LOGO_NAME = 'larp-logo.png';
const LOGO_PATH = resolve(__dirname, '..', '..', 'assets', LOGO_NAME);

const INFRACTION_ACTIONS = [
    'Warning',
    'Strike',
    'Suspension',
    'Demotion',
    'Termination',
    'Blacklist',
] as const;

type InfractionAction = (typeof INFRACTION_ACTIONS)[number];

const INFRACTION_ROLE_KEYS: Record<InfractionAction, ConfigRoleKey> = {
    Warning: 'infraction_warning',
    Strike: 'infraction_strike',
    Suspension: 'infraction_suspension',
    Demotion: 'infraction_demotion',
    Termination: 'infraction_termination',
    Blacklist: 'infraction_blacklist',
};

const DEFAULT_INFRACTION_ROLE_IDS: Partial<Record<ConfigRoleKey, string>> = {
    infraction_warning_1: '1546571033455108228',
    infraction_warning_2: '1546571034369720440',
    infraction_strike_1: '1546571039126065152',
    infraction_strike_2: '1546571039956533258',
    infraction_terminated: '1546571047367606333',
    infraction_blacklisted: '1546571046004719667',
};

const INFRACTION_ROLE_NAMES: Record<InfractionAction, string[]> = {
    Warning: ['warning', 'warning 1', 'warning i', 'warning 2', 'warning ii'],
    Strike: ['strike', 'strike 1', 'strike i', 'strike 2', 'strike ii'],
    Suspension: ['suspension', 'suspended'],
    Demotion: ['demotion', 'demoted'],
    Termination: ['termination', 'terminated'],
    Blacklist: ['blacklist', 'blacklisted'],
};

function normalizedRoleName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function promotionCompanionRoles(guild: NonNullable<ChatInputCommandInteraction['guild']>, rankRole: Role): Role[] {
    const rankName = normalizedRoleName(rankRole.name);
    const byName = (name: string) => guild.roles.cache.find(role => normalizedRoleName(role.name) === normalizedRoleName(name));
    if (rankName === 'director' || rankName.endsWith(' director')) {
        return ['Senior High Rank', 'Directive Team'].map(byName).filter((role): role is Role => Boolean(role));
    }

    const candidates = new Set<string>([`${rankName} team`]);
    const taggedTeam = rankRole.name.match(/(?:\||[-–])\s*(.+)$/);
    if (taggedTeam?.[1]) {
        const teamName = normalizedRoleName(taggedTeam[1]);
        candidates.add(teamName);
        candidates.add(`${teamName} team`);
    }
    const baseRank = rankName.replace(/^(senior|junior|head|lead|trial|assistant|deputy)\s+/, '');
    candidates.add(`${baseRank} team`);

    const companion = guild.roles.cache.find(role => candidates.has(normalizedRoleName(role.name)));
    return companion ? [companion] : [];
}

function directorCompanionRolesMissing(guild: NonNullable<ChatInputCommandInteraction['guild']>, rankRole: Role): string[] {
    const rankName = normalizedRoleName(rankRole.name);
    if (rankName !== 'director' && !rankName.endsWith(' director')) return [];
    return ['Senior High Rank', 'Directive Team'].filter(name =>
        !guild.roles.cache.some(role => normalizedRoleName(role.name) === normalizedRoleName(name)),
    );
}

async function applyInfractionRole(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    memberId: string,
    action: InfractionAction,
): Promise<{ message: string; displayType: string }> {
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) return { message: 'The member could not be found, so no infraction role was applied.', displayType: action };
    await guild.roles.fetch().catch(() => null);
    const config = await getGuildBotConfig(guild);
    const roleNames = INFRACTION_ROLE_NAMES[action];
    const findRole = async (keys: ConfigRoleKey[], names: string[]): Promise<Role | null> => {
        for (const key of keys) {
            const id = config.roles[key] || DEFAULT_INFRACTION_ROLE_IDS[key];
            if (!id) continue;
            const found = await guild.roles.fetch(id).catch(() => null);
            if (found) return found;
        }
        const normalizedNames = new Set(names.map(normalizedRoleName));
        return guild.roles.cache.find(candidate => {
            const name = normalizedRoleName(candidate.name);
            return normalizedNames.has(name) || normalizedNames.has(name.replace(/^(staff|csrp) /, ''));
        }) || null;
    };

    let role: Role | null = null;
    let selectedRoleKey = INFRACTION_ROLE_KEYS[action];
    let displayType: string = action;
    if (action === 'Warning' || action === 'Strike') {
        const prefix = action === 'Warning' ? 'infraction_warning' : 'infraction_strike';
        const tierOneKey = `${prefix}_1` as ConfigRoleKey;
        const tierTwoKey = `${prefix}_2` as ConfigRoleKey;
        const firstRole = await findRole([tierOneKey, INFRACTION_ROLE_KEYS[action]], [`${action} 1`, `${action} I`, `${action} 1 Staff`, action]);
        const secondRole = await findRole([tierTwoKey], [`${action} 2`, `${action} II`, `${action} 2 Staff`]);
        const hasTierOne = Boolean(firstRole && member.roles.cache.has(firstRole.id));
        const hasTierTwo = Boolean(secondRole && member.roles.cache.has(secondRole.id));
        const tier = hasTierTwo || hasTierOne ? 2 : 1;
        displayType = `${action} ${tier === 1 ? 'I' : 'II'}`;
        selectedRoleKey = tier === 2 ? tierTwoKey : tierOneKey;
        role = tier === 2 ? secondRole : firstRole;
        if (!role) {
            const name = `${action} ${tier}`;
            role = await guild.roles.create({ name, reason: `Created automatically for ${name} infractions` }).catch(() => null);
        }
    } else {
        const roleKeys: ConfigRoleKey[] = action === 'Termination'
            ? ['infraction_terminated', 'infraction_termination']
            : action === 'Blacklist'
                ? ['infraction_blacklisted', 'infraction_blacklist']
                : [INFRACTION_ROLE_KEYS[action]];
        role = await findRole(roleKeys, roleNames);
        if (!role) {
            const fallbackName = action === 'Termination' ? 'Terminated' : action === 'Blacklist' ? 'Blacklisted' : action;
            role = await guild.roles.create({ name: fallbackName, reason: `Created automatically for ${action} infractions` }).catch(() => null);
        }
        if (action === 'Termination') selectedRoleKey = 'infraction_terminated';
        if (action === 'Blacklist') selectedRoleKey = 'infraction_blacklisted';
    }
    if (!role) return { message: `The **${action}** role could not be found or created.`, displayType };

    config.roles[selectedRoleKey] = role.id;
    await saveGuildBotConfig(guild, config);
    const configuredInfractionRoleIds = Object.entries(config.roles)
        .filter(([key]) => key.startsWith('infraction_'))
        .map(([, id]) => id)
        .filter((id): id is string => Boolean(id));
    const defaultRoleIds = Object.values(DEFAULT_INFRACTION_ROLE_IDS).filter((id): id is string => Boolean(id));
    const namedRoleIds = guild.roles.cache
        .filter(candidate => Object.values(INFRACTION_ROLE_NAMES).flat().some(name => normalizedRoleName(name) === normalizedRoleName(candidate.name)))
        .map(candidate => candidate.id);
    const otherRoleIds = [...new Set([...configuredInfractionRoleIds, ...defaultRoleIds, ...namedRoleIds])]
        .filter(id => id !== role!.id && member.roles.cache.has(id));
    if (otherRoleIds.length) await member.roles.remove(otherRoleIds, `Replaced by ${action} infraction`).catch(() => undefined);
    const added = await member.roles.add(role, `${action} infraction issued`).then(() => true).catch(() => false);
    return {
        message: added ? `<@&${role.id}> was applied automatically.` : `I found <@&${role.id}>, but could not apply it. Move the bot role above it.`,
        displayType,
    };
}
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
    displayAction?: string;
    reason: string;
    ruleBroken: string;
    evidence: string;
    internalNotes: string;
    notifyMember: boolean;
    expiration: string;
    appealStatus?: string;
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

function buildInfractionPanel(
    record: InfractionRecord,
    configured?: PanelConfig,
    customBannerUrl?: string | null,
    controls: ActionRowBuilder<ButtonBuilder>[] = [],
): ContainerBuilder {
    const config = configured || {
        title: 'Staff Infraction',
        description: '> Hello {member}, you have been issued a {action} towards your account. Please review the infraction.',
    };
    const legacyDefault = '> Hello **{member}**, a **{action}** has been placed on your staff record.\n\n› **Reason:** {reason}\n\n› **Infraction type:** {action}\n\n› **Issued by:** **{issuer}**\n\n› **Appeal status:** {appeal_status}';
    const values = {
        member: `<@${record.memberId}>`,
        action: record.displayAction || record.action,
        reason: record.reason,
        issuer: `<@${record.issuedById}>`,
        appeal_status: record.appealStatus || 'Appealable',
        case_id: record.caseNumber,
        notes: record.ruleBroken,
    };
    const emojis = parseEmojiMap(config.emojiText);
    const intro = config.description === legacyDefault
        ? `> Hello ${values.member}, you have been issued a ${values.action} towards your account. Please review the infraction.`
        : applyTemplate(config.description, values);
    const appeal = (record.appealStatus || 'Appealable') === 'Appealable' ? 'Yes' : 'No';
    const container = new ContainerBuilder()
        .setAccentColor(BRAND_COLOR)
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(INFRACTION_TOP_BANNER),
        ))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `${WARN_EMOJI} **Staff Infraction**`,
            intro,
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `${ARROW_EMOJI} **User** - <@${record.memberId}>`,
            `${ARROW_EMOJI} **Type** - ${values.action}`,
            `${ARROW_EMOJI} **Reason** - ${record.reason}`,
            `${ARROW_EMOJI} **Issued by** - <@${record.issuedById}>`,
            `${ARROW_EMOJI} **Appealable** - ${appeal}`,
        ].join('\n')));
    if (controls.length) container.addActionRowComponents(...controls);
    return container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(STAFF_RECORD_UNDERBANNER),
    ));
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
    const configured = await getPanelConfig(thread.guild, 'infraction');
    const customBannerUrl = await getPanelBannerUrl(thread.guild, configured);
    await message.edit({
        embeds: [],
        components: [buildInfractionPanel(record, configured, customBannerUrl)],
        flags: MessageFlags.IsComponentsV2,
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
                const destination = await getSendableChannel(interaction, CHANNEL_IDS.trainingResults);

                if (!destination) {
                    await interaction.editReply('The training-results channel is unavailable. Please contact an administrator.');
                    return;
                }

                const average = (driving + spag + modCalls + communication + professionalism) / 5;
                const embed = brandedEmbed(
                    `${result === 'Pass' ? '✅' : '❌'} Training Result | ${result}`,
                    result === 'Pass' ? PASS_COLOR : FAIL_COLOR,
                ).setImage(bannerUrl(result === 'Pass' ? 'passed' : 'denied')).addFields(
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

                await destination.send({ components: embedsToV2([embed, underbannerEmbed()]), files: [logoAttachment(), ...bannerFiles(result === 'Pass' ? 'passed' : 'denied')], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
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
                    .addRoleOption(option => option.setName('new-role').setDescription('The new server role for this promotion').setRequired(true))
                    .addStringOption(option => option.setName('reason').setDescription('The reason for the promotion').setRequired(true).setMaxLength(1024))
                    .addUserOption(option => option.setName('approved-by').setDescription('The person who approved the promotion').setRequired(true))
                    .addStringOption(option => option.setName('effective-date').setDescription('The date the promotion takes effect').setRequired(true).setMaxLength(100))
                    .addRoleOption(option => option.setName('old-rank').setDescription('The member\'s current rank, if applicable')),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                interaction.options.getSubcommand(true);
                const member = interaction.options.getUser('member', true);
                const guild = interaction.guild;
                if (!guild) {
                    await interaction.editReply('Promotions can only be issued inside a server.');
                    return;
                }
                const selectedOldRank = interaction.options.getRole('old-rank');
                const selectedNewRole = interaction.options.getRole('new-role', true);
                const [oldRankRole, newRole] = await Promise.all([
                    selectedOldRank ? guild.roles.fetch(selectedOldRank.id).catch(() => null) : Promise.resolve(null),
                    guild.roles.fetch(selectedNewRole.id).catch(() => null),
                ]);
                if (!newRole) {
                    await interaction.editReply('I could not find the selected rank role in this server.');
                    return;
                }
                const reason = interaction.options.getString('reason', true);
                const approvedBy = interaction.options.getUser('approved-by', true);
                const effectiveDate = interaction.options.getString('effective-date', true);
                const destination = await getSendableChannel(interaction, await configuredChannelId(interaction.guild, 'promotions', CHANNEL_IDS.promotions));

                if (!destination) {
                    await interaction.editReply('The promotions channel is unavailable. Please contact an administrator.');
                    return;
                }

                const promotedMember = await guild.members.fetch(member.id).catch(() => null);
                if (!promotedMember) {
                    await interaction.editReply('I could not find that member in this server, so no promotion roles were changed.');
                    return;
                }
                const companionRoles = promotionCompanionRoles(guild, newRole);
                const missingDirectorRoles = directorCompanionRolesMissing(guild, newRole);
                if (missingDirectorRoles.length) {
                    await interaction.editReply(`I could not complete the Director role bundle because these server roles were not found: ${missingDirectorRoles.map(name => `**${name}**`).join(', ')}. Create those roles with those names, then retry.`);
                    return;
                }
                const rolesToAdd = [newRole, ...companionRoles].filter((role, index, roles) =>
                    roles.findIndex(candidate => candidate.id === role.id) === index,
                );
                const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
                if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)
                    || rolesToAdd.some(role => role.managed || botMember.roles.highest.comparePositionTo(role) <= 0)
                    || (oldRankRole && oldRankRole.id !== newRole.id && botMember.roles.highest.comparePositionTo(oldRankRole) <= 0)) {
                    await interaction.editReply('I could not assign this promotion. Give the bot **Manage Roles** and move its role above the promoted rank, team roles, and old rank.');
                    return;
                }
                try {
                    await promotedMember.roles.add(rolesToAdd, `Promotion issued by ${interaction.user.tag}`);
                } catch (error) {
                    console.error('[Staff Management] Promotion role assignment failed.', error);
                    await interaction.editReply('The promotion was not posted because I could not assign the new rank and team roles. Check the bot’s Manage Roles permission and role position.');
                    return;
                }
                let oldRankRemoved = true;
                const oldRankIsRetained = oldRankRole && rolesToAdd.some(role => role.id === oldRankRole.id);
                if (oldRankRole && !oldRankIsRetained && oldRankRole.id !== newRole.id && promotedMember.roles.cache.has(oldRankRole.id)) {
                    oldRankRemoved = await promotedMember.roles.remove(oldRankRole, `Replaced by promotion to ${newRole.name}`).then(() => true).catch(() => false);
                }

                const configured = await getPanelConfig(interaction.guild, 'promotion');
                const values = {
                    promoter: `<@${interaction.user.id}>`,
                    member: `<@${member.id}>`,
                    old_role: oldRankRole ? `<@&${oldRankRole.id}>` : 'None',
                    new_role: `<@&${newRole.id}>`,
                    notes: reason,
                    effective_date: effectiveDate,
                    issuer: `<@${interaction.user.id}>`,
                };
                const legacyPromotionDescription = '*Authorized by **{promoter}***\n\n› **Promoted staff:** **{member}**\n\n› **Previous role:** {old_role}\n\n› **New role:** **{new_role}**\n\n› **Additional notes:** {notes}';
                const promotionIntro = configured.description === legacyPromotionDescription
                    ? `${PROMOTION_EMOJI} Congratulations ${values.member}! The High Ranking team here at **California State Roleplay** has decided to recognize your recent hard work with a promotion.\n\nPromoted by ${values.promoter}`
                    : applyTemplate(configured.description, values);
                await destination.send({
                    components: [new ContainerBuilder()
                        .setAccentColor(BRAND_COLOR)
                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(PROMOTION_TOP_BANNER),
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                            promotionIntro,
                        ].join('\n')))
                        .addSeparatorComponents(new SeparatorBuilder())
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                            `${ARROW_EMOJI} **User** - ${values.member}`,
                            `${ARROW_EMOJI} **Old Rank** - ${values.old_role}`,
                            `${ARROW_EMOJI} **New Rank** - ${values.new_role}`,
                            `${ARROW_EMOJI} **Reason** - ${reason}`,
                            companionRoles.length ? `${ARROW_EMOJI} **Team Role** - ${companionRoles.map(role => `<@&${role.id}>`).join(', ')}` : '',
                        ].filter(Boolean).join('\n')))
                        .addSeparatorComponents(new SeparatorBuilder())
                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(STAFF_RECORD_UNDERBANNER),
                        ))],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [], users: [member.id] },
                });
                await interaction.editReply(`The promotion for ${member.username} has been published and ${rolesToAdd.map(role => `<@&${role.id}>`).join(', ')} assigned automatically.`
                    + `${oldRankRemoved ? '' : '\nThe new rank and team role were assigned, but I could not remove the previous rank. Check the bot’s role position.'}`);
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
                    .addStringOption(option => option.setName('notes').setDescription('Notes about this infraction').setRequired(true).setMaxLength(1024))
                    .addStringOption(option => option.setName('evidence').setDescription('Evidence link or supporting information').setMaxLength(1024))
                    .addStringOption(option => option.setName('internal-notes').setDescription('Private notes for authorized staff').setMaxLength(1024))
                    .addBooleanOption(option => option.setName('notify-member').setDescription('Also notify the member by direct message'))
                    .addStringOption(option => option.setName('expiration').setDescription('When this infraction expires, if applicable').setMaxLength(100))
                    .addStringOption(option => option
                        .setName('appeal-status')
                        .setDescription('Whether this infraction can be appealed')
                        .addChoices(
                            { name: 'Appealable', value: 'Appealable' },
                            { name: 'Not Appealable', value: 'Not Appealable' },
                        )),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                interaction.options.getSubcommand(true);
                if (!interaction.guildId || !interaction.guild) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                const member = interaction.options.getUser('member', true);
                const action = interaction.options.getString('action', true) as InfractionAction;
                const reason = interaction.options.getString('reason', true);
                const notes = interaction.options.getString('notes', true);
                const evidence = interaction.options.getString('evidence') || 'No evidence supplied.';
                const internalNotes = interaction.options.getString('internal-notes') || 'No internal notes supplied.';
                const notifyMember = interaction.options.getBoolean('notify-member') ?? false;
                const expiration = interaction.options.getString('expiration') || 'No expiration set.';
                const appealStatus = interaction.options.getString('appeal-status')
                    || (action === 'Termination' || action === 'Blacklist' ? 'Not Appealable' : 'Appealable');
                const caseNumber = await nextInfractionCaseNumber(interaction.guildId);

                const fetchedParent = await interaction.client.channels.fetch(await configuredChannelId(interaction.guild, 'infractions', CHANNEL_IDS.infractionParent)).catch(() => null);
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
                    ruleBroken: notes,
                    evidence,
                    internalNotes,
                    notifyMember,
                    expiration,
                    appealStatus,
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

                const configured = await getPanelConfig(interaction.guild, 'infraction');
                const customBannerUrl = await getPanelBannerUrl(interaction.guild, configured);
                let detailMessage;
                try {
                    detailMessage = await fetchedParent.send({
                        components: [buildInfractionPanel(record, configured, customBannerUrl)],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [], users: [member.id] },
                    });
                } catch (error) { throw error; }
                record.headerMessageId = detailMessage.id;
                record.detailMessageId = detailMessage.id;
                // No evidence thread or management buttons are created. The infraction is a clean V2 record.
                record.threadId = detailMessage.id;
                const roleResult = await applyInfractionRole(interaction.guild, member.id, action);
                record.displayAction = roleResult.displayType;
                await detailMessage.edit({
                    components: [buildInfractionPanel(record, configured)],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [], users: [member.id] },
                });

                let memberNotified = !notifyMember;
                if (notifyMember) {
                    memberNotified = await member
                        .send({
                            components: [buildInfractionPanel(record, configured, customBannerUrl)],
                            flags: MessageFlags.IsComponentsV2,
                            allowedMentions: { parse: [], users: [member.id] },
                        })
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

                await interaction.editReply(
                    `${caseNumber} was created successfully: ${detailMessage.url}\n${roleResult.message}`
                    + `${memberNotified ? '' : '\nThe member could not be notified by direct message.'}`
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
    const embed = brandedEmbed(title).setDescription(description);
    await thread.send({
        components: embedsToV2([embed]),
        files: [logoAttachment()],
        flags: MessageFlags.IsComponentsV2,
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
