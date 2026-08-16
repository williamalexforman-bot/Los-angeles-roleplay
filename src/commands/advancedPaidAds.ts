import {
    ActionRowBuilder,
    AttachmentBuilder,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { PaidAd, type PaidAdRecord } from '../database/paidAdModel';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const PAID_AD_LOG_CHANNEL_ID = '1538624109897060432';
const PAID_AD_POST_CHANNEL_ID = '1538624666313170964';
const PAID_AD_MANAGEMENT_ROLE_ID = '1521593407850680401';
const EASTERN_TIME_ZONE = 'America/New_York';
const POST_HOUR_EASTERN = 13;
const CADENCE_DAYS = 3;
const SCHEDULER_INTERVAL_MS = 60_000;
const PANEL_COLOR = 0x247bf1;
let scheduler: ReturnType<typeof setInterval> | null = null;

interface EasternParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const easternFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

function easternParts(date: Date): EasternParts {
    const values: Record<string, number> = {};
    for (const part of easternFormatter.formatToParts(date)) {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    }
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second,
    };
}

function shiftLocalDate(year: number, month: number, day: number, days: number) {
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function easternWallClockToUtc(parts: EasternParts): Date {
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let guess = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const represented = easternParts(new Date(guess));
        const representedUtc = Date.UTC(
            represented.year,
            represented.month - 1,
            represented.day,
            represented.hour,
            represented.minute,
            represented.second,
        );
        const correction = target - representedUtc;
        guess += correction;
        if (correction === 0) break;
    }
    return new Date(guess);
}

function dateSlot(date: Date): string {
    const local = easternParts(date);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function nextOnePmEastern(after: Date): Date {
    const local = easternParts(after);
    let candidate = easternWallClockToUtc({ ...local, hour: POST_HOUR_EASTERN, minute: 0, second: 0 });
    if (candidate.getTime() <= after.getTime()) {
        const tomorrow = shiftLocalDate(local.year, local.month, local.day, 1);
        candidate = easternWallClockToUtc({ ...tomorrow, hour: POST_HOUR_EASTERN, minute: 0, second: 0 });
    }
    return candidate;
}

function addEasternDays(date: Date, days: number): Date {
    const local = easternParts(date);
    const shifted = shiftLocalDate(local.year, local.month, local.day, days);
    return easternWallClockToUtc({ ...shifted, hour: POST_HOUR_EASTERN, minute: 0, second: 0 });
}

function underbannerAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.webp' });
}

function underbannerGallery(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(BOTTOM_UNDERBANNER));
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function simplePanel(title: string, lines: readonly string[], color = PANEL_COLOR): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${lines.filter(Boolean).join('\n')}`))
        .addSeparatorComponents(divider())
        .addMediaGalleryComponents(underbannerGallery());
}

function advertisementPanel(ad: PaidAdRecord): ContainerBuilder {
    const ping = ad.pingType === 'everyone' ? '@everyone' : '@here';
    const advertisement = (ad.advertisement || '').replace(/```/g, "'''").slice(0, 2_800);
    return new ContainerBuilder()
        .setAccentColor(PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 📣 Paid Advertisement',
            ping,
            `**Server:** ${ad.serverName}`,
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(advertisement))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `**Server Invite:** ${ad.serverInvite}`,
            `**Advertisement ID:** \`${ad.adId}\``,
        ].join('\n')))
        .addMediaGalleryComponents(underbannerGallery());
}

function completionPanel(ad: PaidAdRecord): ContainerBuilder {
    const unix = ad.scheduledAt ? Math.floor(new Date(ad.scheduledAt).getTime() / 1000) : null;
    return new ContainerBuilder()
        .setAccentColor(0xf0b429)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ✓ Paid Advertisement Setup Complete',
            unix ? `Your advertisement is scheduled for <t:${unix}:F> • <t:${unix}:R>.` : 'Your advertisement is waiting for a posting date.',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '**Post Guidelines**',
            '• Scheduled paid advertisements are spaced at least **3 days apart**.',
            '• Scheduled advertisements post at **1:00 PM Eastern Time**.',
            '• Staff may use `/instant-post` when an advertisement needs to be posted immediately.',
            '• Your invite must still be valid at posting time.',
            '• Submitted information must remain accurate and appropriate for the server.',
            '',
            'Run `/my-paid-ad` at any time to view your advertisement status.',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Advertisement ID: **${ad.adId}**`))
        .addMediaGalleryComponents(underbannerGallery());
}

async function refreshClaimPanel(client: Client, ad: PaidAdRecord): Promise<void> {
    if (!ad.threadId || !ad.setupMessageId || ad.status !== 'Scheduled') return;
    const channel = await client.channels.fetch(ad.threadId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(ad.setupMessageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [completionPanel(ad)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}

async function firstCadenceSlot(now: Date): Promise<Date> {
    const latestRegular = await PaidAd.findOne({
        status: 'Posted',
        postedAt: { $exists: true },
        $or: [
            { instantPostedById: { $exists: false } },
            { instantPostedById: null },
            { instantPostedById: '' },
        ],
    }).sort({ postedAt: -1 }).lean().exec().catch(() => null);

    if (latestRegular?.postedAt) {
        const latest = new Date(latestRegular.postedAt);
        const latestLocal = easternParts(latest);
        const targetDate = shiftLocalDate(latestLocal.year, latestLocal.month, latestLocal.day, CADENCE_DAYS);
        const target = easternWallClockToUtc({ ...targetDate, hour: POST_HOUR_EASTERN, minute: 0, second: 0 });
        if (target.getTime() > now.getTime()) return target;
    }
    return nextOnePmEastern(now);
}

export async function normalizePaidAdSchedule(client?: Client): Promise<void> {
    if (!isDatabaseAvailable()) return;
    const scheduledRaw = await PaidAd.find({ status: 'Scheduled' })
        .sort({ scheduledAt: 1, claimedAt: 1 })
        .lean().exec().catch(() => []);
    if (!scheduledRaw.length) return;

    let cursor = await firstCadenceSlot(new Date());
    const targets = scheduledRaw.map(raw => {
        const ad = raw as unknown as PaidAdRecord;
        const result = { ad, at: cursor, slot: dateSlot(cursor) };
        cursor = addEasternDays(cursor, CADENCE_DAYS);
        return result;
    });

    const unchanged = targets.every(({ ad, at, slot }) =>
        ad.scheduleSlot === slot
        && ad.scheduledAt
        && Math.abs(new Date(ad.scheduledAt).getTime() - at.getTime()) < 1_000
    );
    if (unchanged) return;

    // Clear unique slot values first so old weekly slots cannot collide while
    // the pending queue is compacted into the new 3-day cadence.
    await PaidAd.updateMany({ status: 'Scheduled' }, { $unset: { scheduleSlot: 1 } }).exec();

    for (const { ad, at, slot } of targets) {
        const updatedRaw = await PaidAd.findOneAndUpdate(
            { adId: ad.adId, status: 'Scheduled' },
            { $set: { scheduleSlot: slot, scheduledAt: at, updatedAt: new Date() } },
            { new: true },
        ).lean().exec();
        if (client && updatedRaw) await refreshClaimPanel(client, updatedRaw as unknown as PaidAdRecord);
    }
}

async function paidAdLog(client: Client, title: string, lines: readonly string[], color = PANEL_COLOR): Promise<void> {
    const channel = await client.channels.fetch(PAID_AD_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) return;
    await channel.send({
        components: [simplePanel(title, lines, color)],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}

async function postPaidAdV2(client: Client, adId: string, instantById?: string): Promise<{ ok: true; ad: PaidAdRecord } | { ok: false; message: string }> {
    const lockedRaw = await PaidAd.findOneAndUpdate(
        { adId, status: 'Scheduled' },
        { $set: { status: 'Posting', updatedAt: new Date(), ...(instantById ? { instantPostedById: instantById } : {}) } },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!lockedRaw) return { ok: false, message: 'That advertisement is no longer waiting to be posted.' };
    const ad = lockedRaw as unknown as PaidAdRecord;
    if (!ad.serverName?.trim() || !ad.serverInvite?.trim() || !ad.advertisement?.trim()) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Setup', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'That advertisement setup is incomplete.' };
    }

    const channel = await client.channels.fetch(PAID_AD_POST_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Scheduled', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'The paid-ad posting channel is unavailable.' };
    }

    const message = await channel.send({
        components: [advertisementPanel(ad)],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: ['everyone'] },
    }).catch(() => null);
    if (!message) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Scheduled', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'Discord could not post the advertisement.' };
    }

    const finalRaw = await PaidAd.findOneAndUpdate(
        { adId, status: 'Posting' },
        {
            $set: {
                status: 'Posted',
                postedAt: new Date(),
                postedMessageId: message.id,
                updatedAt: new Date(),
            },
        },
        { new: true },
    ).lean().exec();
    const posted = finalRaw as unknown as PaidAdRecord;
    await paidAdLog(client, instantById ? '⚡ Paid Advertisement Instant Posted' : '✅ Paid Advertisement Posted', [
        `**Advertisement ID:** ${posted.adId}`,
        `**Customer:** <@${posted.userId}>`,
        `**Ping:** @${posted.pingType}`,
        `**Server:** ${posted.serverName}`,
        instantById ? `**Posted By:** <@${instantById}>` : '**Posted By:** Automatic 3-day scheduler',
        `**Message:** ${message.url}`,
    ], 0x22c55e);
    return { ok: true, ad: posted };
}

async function canManagePaidAds(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const configured = [PAID_AD_MANAGEMENT_ROLE_ID, process.env.BOT_PERMISSIONS_ROLE_ID, process.env.ADMIN_ROLE_ID]
        .filter((value): value is string => Boolean(value));
    const member = interaction.member;
    if (member instanceof GuildMember && configured.some(roleId => member.roles.cache.has(roleId))) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched && configured.some(roleId => fetched.roles.cache.has(roleId)));
}

async function executeInstantPost(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await canManagePaidAds(interaction)) {
        await interaction.editReply(`You need <@&${PAID_AD_MANAGEMENT_ROLE_ID}>, an authorized bot-management role, or Administrator permission.`);
        return;
    }
    if (!interaction.guildId || !isDatabaseAvailable()) {
        await interaction.editReply('Paid-ad records are temporarily unavailable.');
        return;
    }

    await normalizePaidAdSchedule(interaction.client);
    const ads = await PaidAd.find({ guildId: interaction.guildId, status: 'Scheduled' })
        .sort({ scheduledAt: 1 })
        .limit(25)
        .lean().exec();
    if (!ads.length) {
        await interaction.editReply('There are no scheduled paid advertisements waiting to be posted.');
        return;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('paid-ad-v2:instant-select')
        .setPlaceholder('Choose a paid advertisement to post now')
        .addOptions(ads.map(raw => {
            const ad = raw as unknown as PaidAdRecord;
            return {
                label: `${ad.serverName || 'Paid Advertisement'} — ${ad.adId}`.slice(0, 100),
                value: ad.adId,
                description: `@${ad.pingType} • ${ad.scheduledAt ? new Date(ad.scheduledAt).toLocaleString('en-US', { timeZone: EASTERN_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No date'}`.slice(0, 100),
            };
        }));

    const panel = new ContainerBuilder()
        .setAccentColor(PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## ⚡ Instant Paid Ad Post\nChoose any pending paid advertisement. It will post immediately as a V2 advertisement emblem.'))
        .addSeparatorComponents(divider())
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
        .addMediaGalleryComponents(underbannerGallery());

    await interaction.editReply({
        components: [panel],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

export async function handleAdvancedPaidAdSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'paid-ad-v2:instant-select') return false;
    await interaction.deferUpdate();
    if (!await canManagePaidAds(interaction)) {
        await interaction.followUp({ content: 'You no longer have permission to instant-post paid advertisements.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const result = await postPaidAdV2(interaction.client, interaction.values[0], interaction.user.id);
    if (result.ok) {
        await normalizePaidAdSchedule(interaction.client).catch(() => undefined);
        await interaction.editReply({
            components: [simplePanel('✅ Advertisement Posted', [`Advertisement **${result.ad.adId}** was posted immediately in <#${PAID_AD_POST_CHANNEL_ID}>.`], 0x22c55e)],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    } else {
        await interaction.editReply({
            components: [simplePanel('❌ Instant Post Failed', [result.message], 0xef4444)],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    }
    return true;
}

export async function runAdvancedPaidAdScheduler(client: Client): Promise<void> {
    if (!isDatabaseAvailable()) return;
    await normalizePaidAdSchedule(client);
    const dueRaw = await PaidAd.findOne({ status: 'Scheduled', scheduledAt: { $lte: new Date() } })
        .sort({ scheduledAt: 1 })
        .lean().exec().catch(() => null);
    if (!dueRaw) return;
    const ad = dueRaw as unknown as PaidAdRecord;
    const result = await postPaidAdV2(client, ad.adId);
    if (!result.ok) {
        logger.warn(`[PaidAdV2] Scheduled post ${ad.adId} failed: ${result.message}`);
        return;
    }
    await normalizePaidAdSchedule(client);
}

export function startAdvancedPaidAdScheduler(client: Client): void {
    if (scheduler) clearInterval(scheduler);
    void runAdvancedPaidAdScheduler(client).catch(error => {
        logger.warn(`[PaidAdV2] Startup scheduler check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    scheduler = setInterval(() => {
        void runAdvancedPaidAdScheduler(client).catch(error => {
            logger.warn(`[PaidAdV2] Scheduler check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }, SCHEDULER_INTERVAL_MS);
    logger.info('Paid advertisement V2 scheduler active: one scheduled ad every 3 days at 1:00 PM Eastern.');
}

export const advancedInstantPostCommand = {
    data: new SlashCommandBuilder()
        .setName('instant-post')
        .setDescription('Staff: instantly post any scheduled paid advertisement as a V2 panel')
        .setDMPermission(false),
    execute: executeInstantPost,
};
