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
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    Role,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    type GuildMember,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.webp';
const INFRACTION_BANNER_NAME = 'infraction-banner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const INFRACTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', INFRACTION_BANNER_NAME);
const INFRACTION_PARENT_CHANNEL_ID = CHANNEL_IDS.infractionParent;

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

type ActivityCheckState = {
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
    status: 'active' | 'ended';
    endedAt?: Date;
    endedById?: string;
};

const ActivityCheckSchema = new mongoose.Schema<ActivityCheckState>({
    checkId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    roleId: { type: String, required: true },
    createdById: { type: String, required: true },
    requiredMemberIds: { type: [String], required: true },
    activeMemberIds: { type: [String], required: true, default: [] },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: false },
    status: { type: String, required: true, enum: ['active', 'ended'], index: true },
    endedAt: { type: Date, required: false },
    endedById: { type: String, required: false },
}, { collection: 'activity_checks' });

const ActivityCheckModel = (mongoose.models.ActivityCheck
    || mongoose.model<ActivityCheckState>('ActivityCheck', ActivityCheckSchema));

const memoryChecks = new Map<string, ActivityCheckState>();
let scheduler: ReturnType<typeof setInterval> | null = null;
let schedulerClient: Client | null = null;

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function activityArtwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function infractionArtwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(INFRACTION_BANNER_PATH, { name: INFRACTION_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function canManage(interaction: ChatInputCommandInteraction): boolean {
    if (interaction.guild?.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const allowed = [process.env.BOT_PERMISSIONS_ROLE_ID, process.env.ADMIN_ROLE_ID, process.env.ACTIVITY_CHECK_MANAGER_ROLE_ID]
        .filter((id): id is string => Boolean(id));
    const member = interaction.member as GuildMember | null;
    return Boolean(member && allowed.some(roleId => member.roles.cache.has(roleId)));
}

function checkPanel(check: ActivityCheckState, ended = false): ContainerBuilder {
    const scheduled = check.endsAt
        ? `<t:${Math.floor(check.endsAt.getTime() / 1000)}:F> • <t:${Math.floor(check.endsAt.getTime() / 1000)}:R>`
        : 'No automatic end scheduled';
    const missing = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id)).length;
    const text = [
        `## ${ended ? '✅ Activity Check Ended' : '🟢 Staff Activity Check'}`,
        ended
            ? 'This activity check is now closed. The button can no longer be used.'
            : 'Staff members with the pinged role must press **I’m Active** before this check ends.',
        '',
        `> **Staff Role:** <@&${check.roleId}>`,
        `> **Started By:** <@${check.createdById}>`,
        `> **Started:** <t:${Math.floor(check.startedAt.getTime() / 1000)}:F>`,
        `> **Scheduled End:** ${scheduled}`,
        `> **Required Staff:** ${check.requiredMemberIds.length}`,
        `> **Marked Active:** ${check.activeMemberIds.length}`,
        `> **Still Missing:** ${missing}`,
        ended && check.endedAt ? `> **Ended:** <t:${Math.floor(check.endedAt.getTime() / 1000)}:F>` : '',
    ].filter(Boolean).join('\n');

    const panel = new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    if (!ended) {
        panel.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`activity-check:active:${check.checkId}`)
                    .setLabel("I'm Active")
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
            ),
        );
    }

    return panel.addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function resultsPanel(check: ActivityCheckState): ContainerBuilder {
    const active = check.activeMemberIds.length
        ? check.activeMemberIds.map(id => `<@${id}>`).join(', ').slice(0, 1800)
        : 'Nobody has responded yet.';
    const missingIds = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    const missing = missingIds.length
        ? missingIds.map(id => `<@${id}>`).join(', ').slice(0, 1800)
        : 'Nobody is missing.';
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 📊 Activity Check Status',
            `> **Required:** ${check.requiredMemberIds.length}`,
            `> **Active:** ${check.activeMemberIds.length}`,
            `> **Missing:** ${missingIds.length}`,
            '',
            '### ✅ Responded',
            active,
            '',
            '### ❌ Still Missing',
            missing,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function saveCheck(check: ActivityCheckState): Promise<void> {
    memoryChecks.set(check.checkId, check);
    if (mongoose.connection.readyState !== 1) return;
    await ActivityCheckModel.updateOne({ checkId: check.checkId }, { $set: check }, { upsert: true }).catch(error => {
        logger.warn(`[ActivityCheck] Persistence failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function loadCheck(checkId: string): Promise<ActivityCheckState | null> {
    const memory = memoryChecks.get(checkId);
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ checkId }).lean().exec().catch(() => null);
    if (!record) return null;
    const check = record as unknown as ActivityCheckState;
    memoryChecks.set(check.checkId, check);
    return check;
}

async function currentCheck(guildId: string): Promise<ActivityCheckState | null> {
    const memory = Array.from(memoryChecks.values()).find(check => check.guildId === guildId && check.status === 'active');
    if (memory) return memory;
    if (mongoose.connection.readyState !== 1) return null;
    const record = await ActivityCheckModel.findOne({ guildId, status: 'active' }).sort({ startedAt: -1 }).lean().exec().catch(() => null);
    if (!record) return null;
    const check = record as unknown as ActivityCheckState;
    memoryChecks.set(check.checkId, check);
    return check;
}

async function snapshotRoleMembers(role: Role): Promise<string[]> {
    try {
        await role.guild.members.fetch();
    } catch (error) {
        throw new Error(`I could not load the complete staff roster for ${role.name}. Enable Discord's Server Members Intent before starting an activity check. (${error instanceof Error ? error.message : 'member fetch failed'})`);
    }
    return role.members.filter(member => !member.user.bot).map(member => member.id);
}

async function issueFailedActivityInfraction(client: Client, check: ActivityCheckState, memberId: string): Promise<boolean> {
    const user = await client.users.fetch(memberId).catch(() => null);
    if (!user) return false;
    const parent = await client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    if (!parent?.isSendable()) return false;

    const now = new Date();
    const panel = new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(INFRACTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ⚖️ Staff Warning • Failed Activity Check',
            `> **User:** <@${memberId}> • \`${user.username}\``,
            `> **Issued By:** <@${check.createdById}>`,
            '> **Action:** `Warning`',
            '> **Violation:** `Failed Activity Check`',
            '> **Reason:** `Did not respond to the required staff activity check before it ended.`',
            `> **Activity Check:** \`${check.checkId}\``,
            `> **Issued:** <t:${Math.floor(now.getTime() / 1000)}:F>`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));

    const message = await parent.send({
        components: [panel],
        files: infractionArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [memberId] },
    }).catch(error => {
        logger.warn(`[ActivityCheck] Could not issue failure infraction for ${memberId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });
    if (!message) return false;

    await user.send({
        components: [panel],
        files: infractionArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return true;
}

async function editOriginalCheck(client: Client, check: ActivityCheckState): Promise<void> {
    const channel = await client.channels.fetch(check.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const message = await channel.messages.fetch(check.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [checkPanel(check, true)],
        attachments: Array.from(message.attachments.values()),
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => undefined);
}

async function finishCheck(client: Client, check: ActivityCheckState, endedById: string): Promise<{ missing: string[]; infractions: number }> {
    if (check.status !== 'active') return { missing: [], infractions: 0 };
    check.status = 'ended';
    check.endedAt = new Date();
    check.endedById = endedById;
    await saveCheck(check);
    await editOriginalCheck(client, check);

    const missing = check.requiredMemberIds.filter(id => !check.activeMemberIds.includes(id));
    let infractions = 0;
    for (const memberId of missing) {
        if (await issueFailedActivityInfraction(client, check, memberId)) infractions += 1;
    }
    return { missing, infractions };
}

async function startCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        await interaction.editReply('Run this command in the server channel where you want the activity-check emblem posted.');
        return;
    }
    if (!canManage(interaction)) {
        await interaction.editReply('You do not have permission to start an activity check.');
        return;
    }
    if (await currentCheck(interaction.guild.id)) {
        await interaction.editReply('There is already an active activity check. End it before starting another one.');
        return;
    }

    const selectedRole = interaction.options.getRole('staff-role');
    const configuredRoleId = process.env.STAFF_TEAM_ROLE_ID?.trim();
    const role = selectedRole instanceof Role
        ? selectedRole
        : configuredRoleId ? await interaction.guild.roles.fetch(configuredRoleId).catch(() => null) : null;
    if (!role) {
        await interaction.editReply('Choose the staff role when running this command, or configure STAFF_TEAM_ROLE_ID.');
        return;
    }

    let requiredMemberIds: string[];
    try {
        requiredMemberIds = await snapshotRoleMembers(role);
    } catch (error) {
        await interaction.editReply(error instanceof Error ? error.message : 'I could not load the complete staff roster.');
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

    const posted = await interaction.channel.send({
        content: `<@&${role.id}>`,
        components: [checkPanel(check)],
        files: activityArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { roles: [role.id] },
    });
    check.messageId = posted.id;
    await saveCheck(check);
    await interaction.editReply(`✅ Activity check started: ${posted.url}${check.endsAt ? `\nScheduled end: <t:${Math.floor(check.endsAt.getTime() / 1000)}:F>` : '\nNo automatic end is scheduled.'}`);
}

async function viewCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const check = await currentCheck(interaction.guildId);
    if (!check) {
        await interaction.editReply('There is no active activity check.');
        return;
    }
    await interaction.editReply({
        components: [resultsPanel(check)],
        files: activityArtwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function endCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !canManage(interaction)) {
        await interaction.editReply('You do not have permission to end an activity check.');
        return;
    }
    const check = await currentCheck(interaction.guildId);
    if (!check) {
        await interaction.editReply('There is no active activity check.');
        return;
    }
    const result = await finishCheck(interaction.client, check, interaction.user.id);
    await interaction.editReply(`✅ Activity check ended. **${check.activeMemberIds.length}** responded, **${result.missing.length}** did not, and **${result.infractions}** automatic warning infraction(s) were posted.`);
}

export const activityCheckCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('activity-check')
            .setDescription('Start a V2 staff activity check.')
            .addRoleOption(option => option
                .setName('staff-role')
                .setDescription('Staff role required to respond. Uses STAFF_TEAM_ROLE_ID when omitted.')
                .setRequired(false))
            .addStringOption(option => option
                .setName('scheduled-end')
                .setDescription('Choose when the check should automatically end.')
                .setRequired(true)
                .addChoices(...DURATION_CHOICES)),
        execute: startCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('view-activity-check')
            .setDescription('View who has and has not responded to the active activity check.'),
        execute: viewCommand,
    },
    {
        data: new SlashCommandBuilder()
            .setName('end-activity-check')
            .setDescription('End the current activity check immediately and process non-responders.'),
        execute: endCommand,
    },
];

export async function handleActivityCheckButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^activity-check:active:(AC-[A-Z0-9]+)$/i);
    if (!match) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const check = await loadCheck(match[1]);
    if (!check || check.status !== 'active') {
        await interaction.editReply('This activity check has already ended or could not be loaded.');
        return true;
    }
    if (!check.requiredMemberIds.includes(interaction.user.id)) {
        await interaction.editReply(`You are not part of <@&${check.roleId}> for this activity check.`);
        return true;
    }
    if (check.activeMemberIds.includes(interaction.user.id)) {
        await interaction.editReply('✅ You are already marked active for this check.');
        return true;
    }
    check.activeMemberIds.push(interaction.user.id);
    await saveCheck(check);
    await interaction.editReply('✅ You have been marked **Active** for this activity check.');
    return true;
}

async function schedulerTick(): Promise<void> {
    const client = schedulerClient;
    if (!client || !client.isReady()) return;
    const dueMemory = Array.from(memoryChecks.values()).filter(check => check.status === 'active' && check.endsAt && check.endsAt.getTime() <= Date.now());
    const dueDb = mongoose.connection.readyState === 1
        ? await ActivityCheckModel.find({ status: 'active', endsAt: { $lte: new Date() } }).lean().exec().catch(() => [])
        : [];
    const due = new Map<string, ActivityCheckState>();
    for (const check of dueMemory) due.set(check.checkId, check);
    for (const record of dueDb) due.set(String(record.checkId), record as unknown as ActivityCheckState);

    for (const check of due.values()) {
        try {
            await finishCheck(client, check, check.createdById);
            logger.info(`[ActivityCheck] ${check.checkId} ended automatically.`);
        } catch (error) {
            logger.warn(`[ActivityCheck] Automatic end failed for ${check.checkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export function startActivityCheckScheduler(client: Client): void {
    schedulerClient = client;
    if (scheduler) return;
    scheduler = setInterval(() => void schedulerTick(), 30_000);
    scheduler.unref?.();
    void schedulerTick();
    logger.info('[ActivityCheck] Scheduler started.');
}
