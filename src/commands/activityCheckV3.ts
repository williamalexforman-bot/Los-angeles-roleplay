import { existsSync } from 'fs';
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
    type Client,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { Counter, Infraction } from '../database/models';
import { logger } from '../utils/logger';

const UNDERBANNER_NAME = 'underbanner.webp';
const INFRACTION_BANNER_NAME = 'infraction-banner.png';
const ASSETS_DIR = resolve(__dirname, '..', '..', 'assets');
const UNDERBANNER_PATH = resolve(ASSETS_DIR, UNDERBANNER_NAME);
const INFRACTION_BANNER_PATH = resolve(ASSETS_DIR, INFRACTION_BANNER_NAME);
const INFRACTION_PARENT_CHANNEL_ID = CHANNEL_IDS.infractionParent;
const DEFAULT_STAFF_TEAM_ROLE_ID = '1521593407791825036';
const ACTIVITY_INFRACTION_EXEMPT_ROLE_ID = '1521593407795888329';

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

const ActivityCheckModel = mongoose.models.ActivityCheck
    || mongoose.model<ActivityCheckState>('ActivityCheck', ActivityCheckSchema);

const memoryChecks = new Map<string, ActivityCheckState>();
let scheduler: ReturnType<typeof setInterval> | null = null;
let localCaseSequence = 0;

function assertArtwork(): void {
    const missing = [
        [UNDERBANNER_NAME, UNDERBANNER_PATH],
        [INFRACTION_BANNER_NAME, INFRACTION_BANNER_PATH],
    ].filter(([, path]) => !existsSync(path)).map(([name]) => name);
    if (missing.length) throw new Error(`Missing required emblem asset(s): ${missing.join(', ')}`);
}

function activityArtwork(): AttachmentBuilder[] {
    assertArtwork();
    return [new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME })];
}

function infractionArtwork(): AttachmentBuilder[] {
    assertArtwork();
    return [
        new AttachmentBuilder(INFRACTION_BANNER_PATH, { name: INFRACTION_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function timestamp(date: Date): string {
    return `<t:${Math.floor(date.getTime() / 1_000)}:F>`;
}

function normalizeCheck(record: ActivityCheckState): ActivityCheckState {
    record.startedAt = new Date(record.startedAt);
    if (record.endsAt) record.endsAt = new Date(record.endsAt);
    if (record.endedAt) record.endedAt = new Date(record.endedAt);
    return record;
}

async function saveCheck(check: ActivityCheckState): Promise<void> {
    memoryChecks.set(check.checkId, check);
    if (mongoose.connection.readyState !== 1) return;
    await ActivityCheckModel.updateOne(
        { checkId: check.checkId },
        { $set: check },
        { upsert: true },
    ).exec().catch(error => logger.warn(
        `[ActivityCheck] Persistence unavailable for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    ));
}

async function loadCheck(checkId: string): Promise<ActivityCheckState | null> {
    const memory = memoryChecks.get(checkId);
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ checkId }).lean().exec().catch(() => null);
    if (!record) return null;
    const normalized = normalizeCheck(record as unknown as ActivityCheckState);
    memoryChecks.set(normalized.checkId, normalized);
    return normalized;
}

async function currentCheck(guildId: string): Promise<ActivityCheckState | null> {
    const memory = [...memoryChecks.values()].find(check => check.guildId === guildId && check.status === 'active');
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ guildId, status: 'active' })
        .sort({ startedAt: -1 }).lean().exec().catch(() => null);
    if (!record) return null;
    const normalized = normalizeCheck(record as unknown as ActivityCheckState);
    memoryChecks.set(normalized.checkId, normalized);
    return normalized;
}

async function snapshotRoleMembers(role: Role): Promise<string[]> {
    await role.guild.members.fetch();
    return [...role.members.values()].filter(member => !member.user.bot).map(member => member.id);
}

async function canManage(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

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
            : '### ⚠️ Required Action\nPress **I’m Active** before this check ends. Missing staff are recorded together in one Activity Check infraction case.',
    ].join('\n');

    const panel = new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (!disabled) {
        panel.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`activity-check:active:${check.checkId}`)
                .setLabel(`I'm Active • ${responded}/${required}`.slice(0, 80))
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
        ));
    }

    return panel
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function mentionList(ids: string[], emptyText: string): string {
    return ids.length ? ids.map((id, index) => `${index + 1}. <@${id}>`).join('\n') : emptyText;
}

function resultsPanel(check: ActivityCheckState): ContainerBuilder {
    const missingIds = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 📊 Activity Check Results • ${check.checkId}`,
            `> **Status:** ${check.status}`,
            `> **Required:** **${check.requiredMemberIds.length}**`,
            `> **Responded:** **${check.activeMemberIds.length}**`,
            `> **Missing:** **${missingIds.length}**`,
            '',
            '### ✅ Responded',
            mentionList(check.activeMemberIds, '• No responses yet.'),
            '',
            '### ❌ Missing',
            mentionList(missingIds, '• Nobody is missing.'),
        ].join('\n').slice(0, 4_000)))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function nextCaseNumber(guildId: string): Promise<string> {
    if (mongoose.connection.readyState === 1) {
        const counter = await Counter.findOneAndUpdate(
            { key: `infraction:${guildId}` },
            { $inc: { value: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean().exec().catch(() => null) as { value?: number } | null;
        if (counter?.value) return `INF-${String(counter.value).padStart(4, '0')}`;
    }
    localCaseSequence += 1;
    return `INF-AC-${Date.now().toString(36).toUpperCase()}-${localCaseSequence}`;
}

function groupStrikePanel(input: {
    caseNumber: string;
    missingIds: string[];
    issuedById: string;
    checkId: string;
    startedAt: Date;
    endedAt: Date;
}): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0xef4444)
        .addMediaGalleryComponents(media(INFRACTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⚠️ Staff Strike • Failed Activity Check',
            `> **Case:** \`${input.caseNumber}\``,
            `> **Affected Staff:** **${input.missingIds.length}**`,
            '> **Action:** **Strike**',
            '> **Status:** `Active`',
            `> **Issued By:** <@${input.issuedById}>`,
            '',
            '### Violation',
            '> **Failed Activity Check**',
            '',
            '### Staff Who Did Not Respond',
            mentionList(input.missingIds, 'Nobody.'),
            '',
            '### Reason',
            "> Did not press **I'm Active** before the required activity check ended.",
            '',
            '### Activity Check Evidence',
            `> **Check:** \`${input.checkId}\``,
            `> **Started:** ${timestamp(input.startedAt)}`,
            `> **Ended:** ${timestamp(input.endedAt)}`,
            '',
            '> This is one combined Activity Check infraction case for the staff listed above.',
        ].join('\n').slice(0, 4_000)))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function filterInfractionEligibleMissing(
    client: Client,
    check: ActivityCheckState,
    missingIds: string[],
): Promise<{ eligible: string[]; exempt: string[]; unresolved: string[] }> {
    const guild = await client.guilds.fetch(check.guildId).catch(() => null);
    if (!guild) return { eligible: [], exempt: [], unresolved: [...missingIds] };

    const eligible: string[] = [];
    const exempt: string[] = [];
    const unresolved: string[] = [];

    for (const memberId of missingIds) {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) {
            unresolved.push(memberId);
            continue;
        }
        if (member.roles.cache.has(ACTIVITY_INFRACTION_EXEMPT_ROLE_ID)) exempt.push(memberId);
        else eligible.push(memberId);
    }

    return { eligible, exempt, unresolved };
}

async function issueCombinedFailedActivityStrike(
    client: Client,
    check: ActivityCheckState,
    missingIds: string[],
): Promise<boolean> {
    if (!missingIds.length) return false;

    const fetchedParent = await client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    if (!(fetchedParent instanceof TextChannel)) {
        logger.warn(`[ActivityCheck] Infraction parent ${INFRACTION_PARENT_CHANNEL_ID} is unavailable.`);
        return false;
    }

    const caseNumber = await nextCaseNumber(check.guildId);
    const endedAt = check.endedAt || new Date();
    const panel = groupStrikePanel({
        caseNumber,
        missingIds,
        issuedById: check.createdById,
        checkId: check.checkId,
        startedAt: check.startedAt,
        endedAt,
    });

    const caseMessage = await fetchedParent.send({
        components: [panel],
        files: infractionArtwork(),
        flags: MessageFlags.IsComponentsV2,
        // Ping only the affected users once. Never ping the Staff Team role.
        allowedMentions: { parse: [], users: missingIds, roles: [], repliedUser: false },
    }).catch(error => {
        logger.warn(`[ActivityCheck] Could not publish combined strike for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });
    if (!caseMessage) return false;

    let threadId = caseMessage.id;
    try {
        const thread = await caseMessage.startThread({
            name: `${caseNumber} | Activity Check | ${missingIds.length} Staff`.slice(0, 100),
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
            reason: `${caseNumber} combined automatic failed activity check strike`,
        });
        threadId = thread.id;
        await thread.send({
            content: [
                '## 📋 Automatic Activity Check Evidence',
                `**Activity Check:** \`${check.checkId}\``,
                `**Required Staff Role:** <@&${check.roleId}>`,
                `**Check Started:** ${timestamp(check.startedAt)}`,
                `**Check Ended:** ${timestamp(endedAt)}`,
                `**Missing Staff:** **${missingIds.length}**`,
                '',
                '### Staff With No Response',
                mentionList(missingIds, 'None.'),
                '',
                '**Result:** One combined Activity Check Strike case created.',
                '',
                '*The evidence thread does not ping the Staff Team role or users again.*',
            ].join('\n').slice(0, 1_950),
            allowedMentions: { parse: [] },
        }).catch(() => undefined);
    } catch (error) {
        logger.warn(`[ActivityCheck] Combined strike thread unavailable for ${caseNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                    memberId: `activity-check:${check.checkId}`,
                    memberUsername: `${missingIds.length} staff members`,
                    issuedById: check.createdById,
                    action: 'Strike',
                    reason: "Did not press I'm Active before the required activity check ended.",
                    ruleBroken: 'Failed Activity Check',
                    evidence: `Automatic activity check ${check.checkId}. Missing: ${missingIds.join(', ')}`,
                    internalNotes: `Combined Activity Check case. Affected Discord IDs: ${missingIds.join(', ')}`,
                    notifyMember: false,
                    appealable: false,
                    expiration: 'No expiration set.',
                    status: 'Active',
                    history: [{
                        action: 'Created',
                        actorId: check.createdById,
                        details: `Combined automatic Strike case created for ${missingIds.length} staff who failed activity check ${check.checkId}.`,
                        timestamp: now,
                    }],
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec().catch(error => logger.warn(
            `[ActivityCheck] Could not persist combined case ${caseNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ));
    }

    logger.info(`[ActivityCheck] ${caseNumber}: one combined Strike case created for ${missingIds.length} staff who failed ${check.checkId}.`);
    return true;
}

async function editOriginalCheck(client: Client, check: ActivityCheckState): Promise<void> {
    const channel = await client.channels.fetch(check.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const message = await channel.messages.fetch(check.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [checkPanel(check, true)],
        attachments: [],
        files: activityArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(error => logger.warn(
        `[ActivityCheck] Could not refresh ended emblem for ${check.checkId}: ${error instanceof Error ? error.message : String(error)}`,
    ));
}

async function finishCheck(
    client: Client,
    check: ActivityCheckState,
    endedById: string,
): Promise<{ missing: string[]; infracted: string[]; exempt: string[]; unresolved: string[]; cases: number }> {
    if (check.status !== 'active') {
        return { missing: [], infracted: [], exempt: [], unresolved: [], cases: 0 };
    }

    check.status = 'ended';
    check.endedAt = new Date();
    check.endedById = endedById;
    await saveCheck(check);
    await editOriginalCheck(client, check);

    const missing = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    const filtered = await filterInfractionEligibleMissing(client, check, missing);

    if (filtered.exempt.length) {
        logger.info(`[ActivityCheck] ${check.checkId}: ${filtered.exempt.length} missing member(s) exempted by role ${ACTIVITY_INFRACTION_EXEMPT_ROLE_ID}.`);
    }
    if (filtered.unresolved.length) {
        logger.warn(`[ActivityCheck] ${check.checkId}: skipped ${filtered.unresolved.length} unresolved member(s).`);
    }

    const issued = filtered.eligible.length
        ? await issueCombinedFailedActivityStrike(client, check, filtered.eligible)
        : false;

    return {
        missing,
        infracted: issued ? filtered.eligible : [],
        exempt: filtered.exempt,
        unresolved: filtered.unresolved,
        cases: issued ? 1 : 0,
    };
}

async function voidCheck(client: Client, check: ActivityCheckState, voidedById: string): Promise<void> {
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
        await interaction.editReply('Run this command in the server channel where you want the activity check posted.');
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
    const role = selectedRole instanceof Role
        ? selectedRole
        : await interaction.guild.roles.fetch(configuredRoleId).catch(() => null);
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
            // The selected staff role is pinged only when the check starts.
            allowedMentions: { parse: [], roles: [role.id] },
        });
        check.messageId = posted.id;
        await saveCheck(check);
        await interaction.editReply(
            `✅ Activity check started: ${posted.url}`
            + `${check.endsAt ? `\nScheduled end: ${timestamp(check.endsAt)}` : '\nNo automatic end is scheduled.'}`
            + '\n⚠️ Missing staff will be recorded in **one combined Activity Check infraction case**.',
        );
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(`[ActivityCheck] Start send failed in ${interaction.channel.id}: ${reason}`);
        await interaction.editReply(`I could not post the Activity Check panel. Discord returned: ${reason.slice(0, 1_500)}`);
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
    await interaction.editReply([
        `✅ Activity check ended. **${check.activeMemberIds.length}** responded and **${result.missing.length}** did not.`,
        `**Combined infraction cases created:** ${result.cases}`,
        `**Staff included in the combined case:** ${result.infracted.length}`,
        result.exempt.length ? `**Exempt from automatic infraction:** ${result.exempt.length}` : '',
        result.unresolved.length ? `**Skipped because member data could not be verified:** ${result.unresolved.length}` : '',
    ].filter(Boolean).join('\n'));
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
    await interaction.editReply(`🛑 ${check.checkId} has been voided. No automatic infraction was issued.`);
}

export const activityCheckCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('activity-check')
            .setDescription('Start a staff activity check with one combined missing-staff infraction.')
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
            .setDescription('View the current Activity Check results.')
            .setDMPermission(false),
        execute: viewCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('end-activity-check')
            .setDescription('End the active check and create one case listing all missing staff.')
            .setDMPermission(false),
        execute: endCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('void-activity-check')
            .setDescription('Void the active check without issuing an infraction.')
            .setDMPermission(false),
        execute: voidCommand,
    },
];

export async function handleActivityCheckButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^activity-check:active:(AC-[A-Z0-9-]+)$/u);
    if (!match) return false;

    // Acknowledge immediately so Discord never times out while Mongo/Discord
    // message edits happen afterward.
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
                attachments: [],
                files: activityArtwork(),
                flags: MessageFlags.IsComponentsV2,
                // Never ping the Staff Team again during counter updates.
                allowedMentions: { parse: [] },
            }).catch(error => logger.warn(
                `[ActivityCheck] Could not refresh panel after response: ${error instanceof Error ? error.message : String(error)}`,
            ));
        }
    }

    await interaction.editReply(`✅ Your response was recorded for **${check.checkId}**.`);
    return true;
}

export function startActivityCheckScheduler(client: Client): void {
    if (scheduler) return;
    scheduler = setInterval(() => {
        void (async () => {
            const now = Date.now();
            const checks = new Map<string, ActivityCheckState>();

            for (const check of memoryChecks.values()) {
                if (check.status === 'active' && check.endsAt && check.endsAt.getTime() <= now) {
                    checks.set(check.checkId, check);
                }
            }

            if (mongoose.connection.readyState === 1) {
                const records = await ActivityCheckModel.find({
                    status: 'active',
                    endsAt: { $lte: new Date(now) },
                }).lean().exec().catch(() => []);
                for (const record of records) {
                    const normalized = normalizeCheck(record as unknown as ActivityCheckState);
                    checks.set(normalized.checkId, normalized);
                }
            }

            for (const check of checks.values()) {
                try {
                    const result = await finishCheck(client, check, client.user?.id || check.createdById);
                    logger.info(`[ActivityCheck] ${check.checkId} ended automatically; ${result.cases} combined case(s) created for ${result.infracted.length} staff.`);
                } catch (error) {
                    logger.warn(`[ActivityCheck] Automatic end failed for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        })();
    }, 30_000);
    scheduler.unref?.();
    logger.info('[ActivityCheck] V3 scheduler active; one combined infraction case and no upper Activity Check banner.');
}

export function stopActivityCheckScheduler(): void {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
}
