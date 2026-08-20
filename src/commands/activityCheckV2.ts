import { resolve } from 'path';
import mongoose from 'mongoose';
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
    PermissionFlagsBits,
    Role,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextChannel,
    TextDisplayBuilder,
    ThreadAutoArchiveDuration,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { Counter, Infraction } from '../database/models';
import { logger } from '../utils/logger';

const ACTIVITY_BANNER_NAME = 'activity-check-banner.jpg';
const ACTIVITY_UNDERBANNER_NAME = 'underbanner.webp';
const INFRACTION_BANNER_NAME = 'infraction-banner.png';
const ACTIVITY_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ACTIVITY_BANNER_NAME);
const ACTIVITY_UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', ACTIVITY_UNDERBANNER_NAME);
const INFRACTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', INFRACTION_BANNER_NAME);
const INFRACTION_PARENT_CHANNEL_ID = CHANNEL_IDS.infractionParent;
const DEFAULT_STAFF_TEAM_ROLE_ID = '1521593407791825036';
const DURATION_CHOICES = [
    { name: 'No Scheduled End', value: 'none' },
    { name: '30 Minutes', value: '30m' },
    { name: '1 Hour', value: '1h' },
    { name: '2 Hours', value: '2h' },
    { name: '4 Hours', value: '4h' },
    { name: '8 Hours', value: '8h' },
    { name: '12 Hours', value: '12h' },
    { name: '24 Hours', value: '24h' },
] as const;
const DURATION_MS: Record<string, number> = {
    '30m': 30 * 60_000,
    '1h': 60 * 60_000,
    '2h': 2 * 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '8h': 8 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '24h': 24 * 60 * 60_000,
};

type ActivityCheckStatus = 'active' | 'ended' | 'voided';
interface ActivityCheckState {
    checkId: string;
    guildId: string;
    channelId: string;
    messageId: string;
    roleId: string;
    createdById: string;
    requiredMemberIds: string[];
    activeMemberIds: string[];
    startedAt: Date;
    endsAt?: Date;
    status: ActivityCheckStatus;
    endedAt?: Date;
    endedById?: string;
}

const ActivityCheckSchema = new mongoose.Schema<ActivityCheckState>({
    checkId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    roleId: { type: String, required: true },
    createdById: { type: String, required: true },
    requiredMemberIds: { type: [String], required: true, default: [] },
    activeMemberIds: { type: [String], required: true, default: [] },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: false, index: true },
    status: { type: String, required: true, enum: ['active', 'ended', 'voided'], index: true },
    endedAt: { type: Date, required: false },
    endedById: { type: String, required: false },
}, { collection: 'activity_checks' });
const ActivityCheckModel = (mongoose.models.ActivityCheck || mongoose.model<ActivityCheckState>('ActivityCheck', ActivityCheckSchema));

const memoryChecks = new Map<string, ActivityCheckState>();
let scheduler: ReturnType<typeof setInterval> | null = null;
let schedulerClient: ChatInputCommandInteraction['client'] | null = null;
let localCaseSequence = 0;

function activityArtwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ACTIVITY_BANNER_PATH, { name: ACTIVITY_BANNER_NAME }),
        new AttachmentBuilder(ACTIVITY_UNDERBANNER_PATH, { name: ACTIVITY_UNDERBANNER_NAME }),
    ];
}

function infractionArtwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(INFRACTION_BANNER_PATH, { name: INFRACTION_BANNER_NAME }),
        new AttachmentBuilder(ACTIVITY_UNDERBANNER_PATH, { name: ACTIVITY_UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function timestamp(date: Date): string {
    return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function saveCheck(check: ActivityCheckState): Promise<void> {
    memoryChecks.set(check.checkId, check);
    if (mongoose.connection.readyState !== 1) return;
    await ActivityCheckModel.updateOne(
        { checkId: check.checkId },
        { $set: check },
        { upsert: true },
    ).exec().catch(error => logger.warn(`[ActivityCheck] Persistence unavailable for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`));
}

async function loadCheck(checkId: string): Promise<ActivityCheckState | null> {
    const memory = memoryChecks.get(checkId);
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ checkId }).lean().exec().catch(() => null);
    if (!record) return null;
    const normalized = record as unknown as ActivityCheckState;
    normalized.startedAt = new Date(normalized.startedAt);
    if (normalized.endsAt) normalized.endsAt = new Date(normalized.endsAt);
    if (normalized.endedAt) normalized.endedAt = new Date(normalized.endedAt);
    memoryChecks.set(normalized.checkId, normalized);
    return normalized;
}

async function currentCheck(guildId: string): Promise<ActivityCheckState | null> {
    const memory = [...memoryChecks.values()].find(check => check.guildId === guildId && check.status === 'active');
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ guildId, status: 'active' }).sort({ startedAt: -1 }).lean().exec().catch(() => null);
    if (!record) return null;
    const normalized = record as unknown as ActivityCheckState;
    normalized.startedAt = new Date(normalized.startedAt);
    if (normalized.endsAt) normalized.endsAt = new Date(normalized.endsAt);
    if (normalized.endedAt) normalized.endedAt = new Date(normalized.endedAt);
    memoryChecks.set(normalized.checkId, normalized);
    return normalized;
}

async function snapshotRoleMembers(role: Role): Promise<string[]> {
    await role.guild.members.fetch();
    return [...role.members.values()].filter(member => !member.user.bot).map(member => member.id);
}

async function canManage(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const configured = [
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
    ].filter((value): value is string => Boolean(value));
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member && configured.some(roleId => member.roles.cache.has(roleId)));
}

function checkPanel(check: ActivityCheckState, disabled = false): ContainerBuilder {
    const required = check.requiredMemberIds.length;
    const responded = check.activeMemberIds.length;
    const pending = Math.max(0, required - responded);
    const content = [
        `<@&${check.roleId}>`,
        '## 📋 Staff Activity Check',
        `> **Staff Role:** <@&${check.roleId}>`,
        `> **Started By:** <@${check.createdById}>`,
        `> **Started:** ${timestamp(check.startedAt)}`,
        `> **Scheduled End:** ${check.endsAt ? timestamp(check.endsAt) : 'Manual end only'}`,
        `> **Required Staff:** **${required}**`,
        `> **Responded:** **${responded}**`,
        `> **Pending:** **${pending}**`,
        '',
        disabled
            ? check.status === 'voided'
                ? '### 🛑 This activity check was voided.'
                : '### ✅ This activity check has ended.'
            : '### ⚠️ Required Action\nPress **I’m Active** before this check ends. Staff who do not respond will automatically receive a **Strike**.',
    ].join('\n');

    const panel = new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ACTIVITY_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (!disabled) {
        panel.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`activity-check:active:${check.checkId}`)
                .setLabel("I'm Active")
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
        ));
    }
    return panel.addSeparatorComponents(separator()).addMediaGalleryComponents(media(ACTIVITY_UNDERBANNER_NAME));
}

function resultsPanel(check: ActivityCheckState): ContainerBuilder {
    const responded = check.activeMemberIds.length
        ? check.activeMemberIds.map(id => `• <@${id}>`).join('\n')
        : '• No responses yet.';
    const missingIds = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    const missing = missingIds.length ? missingIds.map(id => `• <@${id}>`).join('\n') : '• Nobody is missing.';
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ACTIVITY_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 📊 Activity Check Results • ${check.checkId}`,
            `> **Status:** ${check.status}`,
            `> **Required:** **${check.requiredMemberIds.length}**`,
            `> **Responded:** **${check.activeMemberIds.length}**`,
            `> **Missing:** **${missingIds.length}**`,
            '',
            '### ✅ Responded',
            responded,
            '',
            '### ❌ Missing',
            missing,
        ].join('\n').slice(0, 4_000)))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(ACTIVITY_UNDERBANNER_NAME));
}

async function nextCaseNumber(guildId: string): Promise<string> {
    if (mongoose.connection.readyState === 1) {
        const counter = await Counter.findOneAndUpdate(
            { key: `infraction:${guildId}` },
            { $inc: { sequence: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean().exec().catch(() => null);
        if (counter?.sequence) return `INF-${String(counter.sequence).padStart(4, '0')}`;
    }
    localCaseSequence += 1;
    return `INF-AC-${Date.now().toString(36).toUpperCase()}-${localCaseSequence}`;
}

function strikePanel(input: {
    caseNumber: string;
    memberId: string;
    username: string;
    issuedById: string;
    checkId: string;
    startedAt: Date;
    endedAt: Date;
    appealKey: string;
}): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0xef4444)
        .addMediaGalleryComponents(media(INFRACTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⚠️ Staff Strike • Failed Activity Check',
            `> **Case:** \`${input.caseNumber}\``,
            `> **User:** <@${input.memberId}> • \`${input.username}\``,
            '> **Action:** **Strike**',
            '> **Status:** `Active`',
            `> **Issued By:** <@${input.issuedById}>`,
            '',
            '### Violation',
            '> **Failed Activity Check**',
            '',
            '### Reason',
            "> Did not press **I'm Active** before the required activity check ended.",
            '',
            '### Activity Check Evidence',
            `> **Check:** \`${input.checkId}\``,
            `> **Started:** ${timestamp(input.startedAt)}`,
            `> **Ended:** ${timestamp(input.endedAt)}`,
            '> **Response Recorded:** No',
            '',
            '> **Appealable:** Yes',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`infraction-appeal:start:${input.appealKey}`)
                .setLabel('Appeal Infraction')
                .setEmoji('⚖️')
                .setStyle(ButtonStyle.Secondary),
        ))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(ACTIVITY_UNDERBANNER_NAME));
}

async function issueFailedActivityStrike(client: ChatInputCommandInteraction['client'], check: ActivityCheckState, memberId: string): Promise<boolean> {
    const user = await client.users.fetch(memberId).catch(() => null);
    if (!user) return false;
    const fetchedParent = await client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    if (!(fetchedParent instanceof TextChannel)) {
        logger.warn(`[ActivityCheck] Infraction parent ${INFRACTION_PARENT_CHANNEL_ID} is unavailable.`);
        return false;
    }

    const caseNumber = await nextCaseNumber(check.guildId);
    const endedAt = check.endedAt || new Date();
    const panel = strikePanel({
        caseNumber,
        memberId,
        username: user.username,
        issuedById: check.createdById,
        checkId: check.checkId,
        startedAt: check.startedAt,
        endedAt,
        appealKey: caseNumber,
    });

    const caseMessage = await fetchedParent.send({
        components: [panel],
        files: infractionArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [memberId] },
    }).catch(error => {
        logger.warn(`[ActivityCheck] Could not publish strike for ${memberId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });
    if (!caseMessage) return false;

    let threadId = caseMessage.id;
    try {
        const thread = await caseMessage.startThread({
            name: `${caseNumber} | ${user.username} | Strike`.slice(0, 100),
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
            reason: `${caseNumber} automatic failed activity check strike`,
        });
        threadId = thread.id;
        await thread.send([
            '## 📋 Automatic Activity Check Evidence',
            `**Activity Check:** \`${check.checkId}\``,
            `**Required Staff Role:** <@&${check.roleId}>`,
            `**Member:** <@${memberId}>`,
            `**Check Started:** <t:${Math.floor(check.startedAt.getTime() / 1000)}:F>`,
            `**Check Ended:** <t:${Math.floor(endedAt.getTime() / 1000)}:F>`,
            '**Response:** No response recorded before closure.',
            '**Result:** Automatic Strike issued.',
        ].join('\n')).catch(() => undefined);
    } catch (error) {
        logger.warn(`[ActivityCheck] Strike thread unavailable for ${caseNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const now = new Date();
    if (mongoose.connection.readyState === 1) {
        await Infraction.findOneAndUpdate(
            { caseNumber },
            {
                $set: {
                    caseNumber,
                    guildId: check.guildId,
                    number: Number(caseNumber.replace(/\D/g, '')) || Date.now(),
                    threadId,
                    parentChannelId: fetchedParent.id,
                    headerMessageId: caseMessage.id,
                    detailMessageId: caseMessage.id,
                    memberId,
                    memberUsername: user.username,
                    issuedById: check.createdById,
                    action: 'Strike',
                    reason: "Did not press I'm Active before the required activity check ended.",
                    ruleBroken: 'Failed Activity Check',
                    evidence: `Automatic activity check ${check.checkId} response record.`,
                    internalNotes: `Automatically issued by activity check ${check.checkId}.`,
                    notifyMember: true,
                    appealable: true,
                    expiration: 'No expiration set.',
                    status: 'Active',
                    history: [{
                        action: 'Created',
                        actorId: check.createdById,
                        details: `Automatic Strike issued for failing activity check ${check.checkId}.`,
                        timestamp: now,
                    }],
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec().catch(error => {
            logger.warn(`[ActivityCheck] Could not persist ${caseNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }

    await user.send({
        components: [panel],
        files: infractionArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);

    logger.info(`[ActivityCheck] ${caseNumber}: Strike issued to ${user.tag} for failing ${check.checkId}.`);
    return true;
}

async function editOriginalCheck(client: ChatInputCommandInteraction['client'], check: ActivityCheckState): Promise<void> {
    const channel = await client.channels.fetch(check.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const message = await channel.messages.fetch(check.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [checkPanel(check, true)],
        attachments: [...message.attachments.values()],
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => undefined);
}

async function finishCheck(client: ChatInputCommandInteraction['client'], check: ActivityCheckState, endedById: string): Promise<{ missing: string[]; strikes: number }> {
    if (check.status !== 'active') return { missing: [], strikes: 0 };
    check.status = 'ended';
    check.endedAt = new Date();
    check.endedById = endedById;
    await saveCheck(check);
    await editOriginalCheck(client, check);

    const missing = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    let strikes = 0;
    for (const memberId of missing) {
        if (await issueFailedActivityStrike(client, check, memberId)) strikes += 1;
    }
    return { missing, strikes };
}

async function voidCheck(client: ChatInputCommandInteraction['client'], check: ActivityCheckState, voidedById: string): Promise<void> {
    if (check.status !== 'active') return;
    check.status = 'voided';
    check.endedAt = new Date();
    check.endedById = voidedById;
    await saveCheck(check);
    await editOriginalCheck(client, check);
}

async function startCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        await interaction.editReply('Run this command in the server channel where you want the activity-check emblem posted.');
        return;
    }
    if (!(await canManage(interaction))) {
        await interaction.editReply('You do not have permission to start an activity check.');
        return;
    }
    if (await currentCheck(interaction.guild.id)) {
        await interaction.editReply('There is already an active activity check. End or void it before starting another one.');
        return;
    }

    const selectedRole = interaction.options.getRole('staff-role');
    const configuredRoleId = process.env.STAFF_TEAM_ROLE_ID?.trim() || DEFAULT_STAFF_TEAM_ROLE_ID;
    const role = selectedRole instanceof Role ? selectedRole : await interaction.guild.roles.fetch(configuredRoleId).catch(() => null);
    if (!role) {
        await interaction.editReply(`The configured Staff Team role <@&${configuredRoleId}> could not be loaded.`);
        return;
    }

    let requiredMemberIds: string[];
    try {
        requiredMemberIds = await snapshotRoleMembers(role);
    } catch (error) {
        await interaction.editReply(`I could not load the complete staff roster. Make sure Server Members Intent is enabled. ${error instanceof Error ? error.message : ''}`);
        return;
    }
    if (!requiredMemberIds.length) {
        await interaction.editReply('That role currently has no non-bot members to check.');
        return;
    }

    const duration = interaction.options.getString('scheduled-end', true);
    const startedAt = new Date();
    const check: ActivityCheckState = {
        checkId: `AC-${Date.now().toString(36).toUpperCase()}`,
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        messageId: '',
        roleId: role.id,
        createdById: interaction.user.id,
        requiredMemberIds,
        activeMemberIds: [],
        startedAt,
        endsAt: duration === 'none' ? undefined : new Date(startedAt.getTime() + DURATION_MS[duration]),
        status: 'active',
    };

    try {
        const posted = await interaction.channel.send({
            components: [checkPanel(check)],
            files: activityArtwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], roles: [role.id] },
        });
        check.messageId = posted.id;
        await saveCheck(check);
        await interaction.editReply(`✅ Activity check started: ${posted.url}${check.endsAt ? `\nScheduled end: <t:${Math.floor(check.endsAt.getTime() / 1000)}:F>` : '\nNo automatic end is scheduled.'}\n⚠️ Anyone who does not respond will automatically receive a **Strike**.`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(`[ActivityCheck] Start send failed in ${interaction.channel.id}: ${reason}`);
        await interaction.editReply(`I could not post the activity-check V2 emblem. Discord returned: ${reason.slice(0, 1_500)}`);
    }
}

async function viewCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) return void interaction.editReply('This command can only be used in a server.');
    const check = await currentCheck(interaction.guildId);
    if (!check) return void interaction.editReply('There is no active activity check.');
    await interaction.editReply({
        components: [resultsPanel(check)],
        files: activityArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function endCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !(await canManage(interaction))) {
        await interaction.editReply('You do not have permission to end an activity check.');
        return;
    }
    const check = await currentCheck(interaction.guildId);
    if (!check) return void interaction.editReply('There is no active activity check.');
    const result = await finishCheck(interaction.client, check, interaction.user.id);
    await interaction.editReply(`✅ Activity check ended. **${check.activeMemberIds.length}** responded, **${result.missing.length}** did not, and **${result.strikes}** automatic Strike case(s) were issued.`);
}

async function voidCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !(await canManage(interaction))) {
        await interaction.editReply('You do not have permission to void an activity check.');
        return;
    }
    const check = await currentCheck(interaction.guildId);
    if (!check) return void interaction.editReply('There is no active activity check to void.');
    await voidCheck(interaction.client, check, interaction.user.id);
    await interaction.editReply(`🛑 ${check.checkId} has been voided. No automatic strikes were issued.`);
}

export const activityCheckCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('activity-check')
            .setDescription('Start a staff activity check with automatic strikes.')
            .setDMPermission(false)
            .addStringOption(option => option
                .setName('scheduled-end')
                .setDescription('Choose when the check should automatically end.')
                .setRequired(true)
                .addChoices(...DURATION_CHOICES))
            .addRoleOption(option => option
                .setName('staff-role')
                .setDescription('Optional override. Defaults to the configured Staff Team role.')
                .setRequired(false)),
        execute: startCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('view-activity-check')
            .setDescription('View the current activity-check results.')
            .setDMPermission(false),
        execute: viewCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('end-activity-check')
            .setDescription('End the active check and strike all missing staff.')
            .setDMPermission(false),
        execute: endCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('void-activity-check')
            .setDescription('Void the active check without issuing strikes.')
            .setDMPermission(false),
        execute: voidCommand,
    },
];

export async function handleActivityCheckButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^activity-check:active:(AC-[A-Z0-9-]+)$/u);
    if (!match) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const check = await loadCheck(match[1]);
    if (!check || check.status !== 'active') {
        await interaction.editReply('This activity check is no longer active.');
        return true;
    }
    if (interaction.guildId !== check.guildId || !check.requiredMemberIds.includes(interaction.user.id)) {
        await interaction.editReply('You are not part of the staff role being checked.');
        return true;
    }
    if (!check.activeMemberIds.includes(interaction.user.id)) {
        check.activeMemberIds.push(interaction.user.id);
        await saveCheck(check);
    }
    const channel = await interaction.client.channels.fetch(check.channelId).catch(() => null);
    if (channel?.type === ChannelType.GuildText) {
        const message = await channel.messages.fetch(check.messageId).catch(() => null);
        if (message) {
            await message.edit({
                components: [checkPanel(check)],
                attachments: [...message.attachments.values()],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => undefined);
        }
    }
    await interaction.editReply(`✅ Your response was recorded for **${check.checkId}**.`);
    return true;
}

export function startActivityCheckScheduler(client: ChatInputCommandInteraction['client']): void {
    schedulerClient = client;
    if (scheduler) return;
    scheduler = setInterval(() => {
        void (async () => {
            const now = Date.now();
            const checks = new Map<string, ActivityCheckState>();
            for (const check of memoryChecks.values()) {
                if (check.status === 'active' && check.endsAt && check.endsAt.getTime() <= now) checks.set(check.checkId, check);
            }
            if (mongoose.connection.readyState === 1) {
                const records = await ActivityCheckModel.find({ status: 'active', endsAt: { $lte: new Date(now) } }).lean().exec().catch(() => []);
                for (const record of records) {
                    const normalized = record as unknown as ActivityCheckState;
                    normalized.startedAt = new Date(normalized.startedAt);
                    if (normalized.endsAt) normalized.endsAt = new Date(normalized.endsAt);
                    checks.set(normalized.checkId, normalized);
                }
            }
            for (const check of checks.values()) {
                try {
                    await finishCheck(client, check, client.user?.id || check.createdById);
                    logger.info(`[ActivityCheck] ${check.checkId} ended automatically.`);
                } catch (error) {
                    logger.warn(`[ActivityCheck] Automatic end failed for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        })();
    }, 30_000);
    logger.info('[ActivityCheck] V2 scheduler active; automatic failed-check strikes enabled.');
}

export function stopActivityCheckScheduler(): void {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
    schedulerClient = null;
}
