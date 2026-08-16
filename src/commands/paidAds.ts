import { randomInt } from 'node:crypto';
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
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextChannel,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { PaidAd, type PaidAdRecord } from '../database/paidAdModel';
import { resolveDockRobloxProfile } from '../services/dockService';
import {
    paidAdProducts,
    robloxUserOwnsConfiguredItem,
    type PaidAdProductConfig,
} from '../services/marketplacePurchaseService';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const MARKETPLACE_CHANNEL_ID = '1526035127606706196';
const PAID_AD_LOG_CHANNEL_ID = '1538624109897060432';
const PAID_AD_POST_CHANNEL_ID = '1538624666313170964';
const PAID_AD_MANAGEMENT_ROLE_ID = '1521593407850680401';
const EASTERN_TIME_ZONE = 'America/New_York';
const SCHEDULER_INTERVAL_MS = 60_000;
const PANEL_COLOR = 0x247bf1;
let paidAdScheduler: ReturnType<typeof setInterval> | null = null;

type SetupField = 'serverName' | 'serverInvite' | 'advertisement';

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

function saturdaySlotStartingAt(after: Date, weekOffset = 0): { slot: string; at: Date } {
    const local = easternParts(after);
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    let daysUntilSaturday = (6 - weekday + 7) % 7;
    let target = shiftLocalDate(local.year, local.month, local.day, daysUntilSaturday + weekOffset * 7);
    let at = easternWallClockToUtc({ ...target, hour: 12, minute: 0, second: 0 });
    if (weekOffset === 0 && at.getTime() <= after.getTime()) {
        target = shiftLocalDate(target.year, target.month, target.day, 7);
        at = easternWallClockToUtc({ ...target, hour: 12, minute: 0, second: 0 });
    }
    const slot = `${target.year}-${String(target.month).padStart(2, '0')}-${String(target.day).padStart(2, '0')}`;
    return { slot, at };
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

function basePanel(title: string, description?: string, color = PANEL_COLOR): ContainerBuilder {
    const panel = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}${description ? `\n${description}` : ''}`));
    return panel;
}

function submittedButton(): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`paid-ad:submitted:${randomInt(100000, 999999)}`)
        .setLabel('Submitted')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true);
}

function setupButton(field: SetupField, adId: string): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`paid-ad:field:${field}:${adId}`)
        .setLabel('Submit')
        .setStyle(ButtonStyle.Secondary);
}

function setupSection(
    title: string,
    help: string,
    field: SetupField,
    ad: PaidAdRecord,
): SectionBuilder {
    const value = ad[field];
    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${title}**\n${value ? '✓ Information saved.' : help}`),
        )
        .setButtonAccessory(value ? submittedButton() : setupButton(field, ad.adId));
}

function buildSetupPanel(ad: PaidAdRecord): ContainerBuilder {
    return basePanel(
        '✓ Purchase Complete',
        `Thank you for your purchase <@${ad.userId}>`,
        0xf0b429,
    )
        .addSeparatorComponents(divider())
        .addSectionComponents(
            setupSection('Server Name', 'Please provide us with your complete server name.', 'serverName', ad),
            setupSection('Server Invite', 'Include a permanent Discord server invite link.', 'serverInvite', ad),
            setupSection('Advertisement', 'Provide the text that will be posted with the ping.', 'advertisement', ad),
        )
        .addSeparatorComponents(divider())
        .addMediaGalleryComponents(underbannerGallery());
}

function buildCompletionPanel(ad: PaidAdRecord): ContainerBuilder {
    const scheduledUnix = ad.scheduledAt ? Math.floor(new Date(ad.scheduledAt).getTime() / 1000) : null;
    const scheduled = scheduledUnix
        ? `Your advertisement is scheduled for <t:${scheduledUnix}:F> • <t:${scheduledUnix}:R>.`
        : 'Your advertisement is waiting for a posting date.';
    return basePanel('✓ Paid Advertisement Setup Complete', scheduled, 0xf0b429)
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '**Post Guidelines**',
            '• Paid advertisements are placed into weekly posting slots.',
            '• Only one scheduled paid advertisement is posted per week.',
            '• Staff may use priority or instant posting when appropriate.',
            '• Your invite must still be valid when the advertisement is posted.',
            '• Submitted information must remain accurate and appropriate for the server.',
            '',
            'Run `/my-paid-ad` at any time to view your advertisement status.',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Advertisement ID: **${ad.adId}**`))
        .addMediaGalleryComponents(underbannerGallery());
}

function buildSimplePanel(title: string, lines: readonly string[], color = PANEL_COLOR): ContainerBuilder {
    return basePanel(title, lines.filter(Boolean).join('\n'), color)
        .addSeparatorComponents(divider())
        .addMediaGalleryComponents(underbannerGallery());
}

async function sendV2Reply(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
    panel: ContainerBuilder,
): Promise<void> {
    await interaction.editReply({
        components: [panel],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

function isComplete(ad: PaidAdRecord): boolean {
    return Boolean(ad.serverName?.trim() && ad.serverInvite?.trim() && ad.advertisement?.trim());
}

async function canManagePaidAds(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    if ('memberPermissions' in interaction && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const member = interaction.member;
    if (member instanceof GuildMember) {
        if (member.roles.cache.has(PAID_AD_MANAGEMENT_ROLE_ID)) return true;
        const botRole = process.env.BOT_PERMISSIONS_ROLE_ID;
        if (botRole && member.roles.cache.has(botRole)) return true;
    }
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!fetched) return false;
    return fetched.permissions.has(PermissionFlagsBits.Administrator)
        || fetched.roles.cache.has(PAID_AD_MANAGEMENT_ROLE_ID)
        || Boolean(process.env.BOT_PERMISSIONS_ROLE_ID && fetched.roles.cache.has(process.env.BOT_PERMISSIONS_ROLE_ID));
}

async function paidAdLog(client: Client, title: string, lines: readonly string[], color = PANEL_COLOR): Promise<void> {
    const channel = await client.channels.fetch(PAID_AD_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[PaidAd] Log channel ${PAID_AD_LOG_CHANNEL_ID} is unavailable.`);
        return;
    }
    await channel.send({
        components: [buildSimplePanel(title, lines, color)],
        files: [underbannerAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(error => {
        logger.warn(`[PaidAd] Could not send log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function generateAdId(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const id = String(randomInt(10_000_000, 100_000_000));
        if (!await PaidAd.exists({ adId: id })) return id;
    }
    throw new Error('Could not allocate an advertisement ID.');
}

async function findUnclaimedOwnedProduct(
    guildId: string,
    robloxUserId: string,
): Promise<{ product: PaidAdProductConfig | null; error?: string }> {
    const products = paidAdProducts();
    if (!products.length) {
        return {
            product: null,
            error: 'Paid-ad Roblox product IDs have not been configured yet. Add the marketplace item IDs first.',
        };
    }

    let lastError: string | undefined;
    for (const product of products) {
        const ownership = await robloxUserOwnsConfiguredItem(robloxUserId, product);
        if (!ownership.ok) {
            lastError = ownership.message;
            continue;
        }
        if (!ownership.owned) continue;
        const alreadyClaimed = await PaidAd.exists({ guildId, robloxUserId, productItemId: product.itemId });
        if (!alreadyClaimed) return { product };
    }
    return { product: null, error: lastError };
}

async function allocateWeeklySchedule(adId: string, guildId: string): Promise<PaidAdRecord> {
    for (let week = 0; week < 104; week += 1) {
        const candidate = saturdaySlotStartingAt(new Date(), week);
        const occupied = await PaidAd.exists({ guildId, scheduleSlot: candidate.slot });
        if (occupied) continue;
        try {
            const updated = await PaidAd.findOneAndUpdate(
                { adId, status: 'Setup' },
                {
                    $set: {
                        status: 'Scheduled',
                        scheduleSlot: candidate.slot,
                        scheduledAt: candidate.at,
                        updatedAt: new Date(),
                    },
                },
                { new: true },
            ).lean().exec();
            if (updated) return updated as unknown as PaidAdRecord;
        } catch (error) {
            const code = (error as { code?: number }).code;
            if (code === 11000) continue;
            throw error;
        }
    }
    throw new Error('No weekly advertisement slot is currently available.');
}

async function updateSetupMessage(client: Client, ad: PaidAdRecord): Promise<void> {
    if (!ad.threadId || !ad.setupMessageId) return;
    const thread = await client.channels.fetch(ad.threadId).catch(() => null);
    if (!thread?.isTextBased() || !('messages' in thread)) return;
    const message = await thread.messages.fetch(ad.setupMessageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [ad.status === 'Setup' ? buildSetupPanel(ad) : buildCompletionPanel(ad)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}

async function completeSetupIfReady(client: Client, ad: PaidAdRecord): Promise<PaidAdRecord> {
    if (ad.status !== 'Setup' || !isComplete(ad)) return ad;
    const scheduled = await allocateWeeklySchedule(ad.adId, ad.guildId);
    await updateSetupMessage(client, scheduled);
    await paidAdLog(client, '📅 Paid Advertisement Scheduled', [
        `**Advertisement ID:** ${scheduled.adId}`,
        `**Customer:** <@${scheduled.userId}>`,
        `**Roblox:** ${scheduled.robloxUsername} (${scheduled.robloxUserId})`,
        `**Ping:** @${scheduled.pingType}`,
        `**Scheduled:** <t:${Math.floor(new Date(scheduled.scheduledAt!).getTime() / 1000)}:F>`,
        `**Server:** ${scheduled.serverName}`,
    ], 0x22c55e);
    return scheduled;
}

async function claimPaidAd(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.guildId) {
        await interaction.editReply('This purchase can only be claimed inside the server.');
        return;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply('Paid-ad claims are temporarily unavailable because the database is offline.');
        return;
    }

    const dock = await resolveDockRobloxProfile(interaction.guildId, interaction.user.id);
    if (!dock.ok) {
        await interaction.editReply(`I could not verify your Roblox account through Dock. ${dock.message}`);
        return;
    }

    const ownership = await findUnclaimedOwnedProduct(interaction.guildId, dock.profile.robloxId);
    if (!ownership.product) {
        await interaction.editReply(
            ownership.error
                ? `I could not verify an unclaimed paid-ad purchase. ${ownership.error}`
                : 'I could not find an unclaimed paid-ad purchase in your verified Roblox inventory.',
        );
        return;
    }

    const marketplace = await interaction.client.channels.fetch(MARKETPLACE_CHANNEL_ID).catch(() => null);
    if (!(marketplace instanceof TextChannel)) {
        await interaction.editReply('The marketplace channel is unavailable for private claim threads.');
        return;
    }

    const adId = await generateAdId();
    let created: PaidAdRecord | null = null;
    try {
        const document = await PaidAd.create({
            adId,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            discordUsername: interaction.user.username,
            robloxUserId: dock.profile.robloxId,
            robloxUsername: dock.profile.username || `Roblox User ${dock.profile.robloxId}`,
            productKey: ownership.product.key,
            productItemType: ownership.product.itemType,
            productItemId: ownership.product.itemId,
            pingType: ownership.product.pingType,
            threadId: '',
            setupMessageId: '',
            status: 'Setup',
            claimedAt: new Date(),
            updatedAt: new Date(),
        });
        created = document.toObject() as PaidAdRecord;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) {
            await interaction.editReply('That Roblox purchase has already been claimed.');
            return;
        }
        throw error;
    }

    try {
        const thread = await marketplace.threads.create({
            name: `Advertisement Claim — ${adId}`,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `Paid advertisement claim for ${interaction.user.tag}`,
        });
        await thread.members.add(interaction.user.id);
        const setupMessage = await thread.send({
            components: [buildSetupPanel(created)],
            files: [underbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        const saved = await PaidAd.findOneAndUpdate(
            { adId },
            { $set: { threadId: thread.id, setupMessageId: setupMessage.id, updatedAt: new Date() } },
            { new: true },
        ).lean().exec();
        created = saved as unknown as PaidAdRecord;

        await paidAdLog(interaction.client, '🛒 Paid Advertisement Claimed', [
            `**Advertisement ID:** ${adId}`,
            `**Customer:** <@${interaction.user.id}>`,
            `**Roblox:** ${created.robloxUsername} (${created.robloxUserId})`,
            `**Product:** ${ownership.product.label}`,
            `**Thread:** <#${thread.id}>`,
        ]);
        await interaction.editReply(`✅ Purchase verified. Your private setup thread is ready: <#${thread.id}>`);
    } catch (error) {
        await PaidAd.deleteOne({ adId }).exec().catch(() => undefined);
        throw error;
    }
}

function setupModal(field: SetupField, adId: string): ModalBuilder {
    const config = field === 'serverName'
        ? { title: 'Server Name', label: 'Complete server name', placeholder: 'Los Angeles Roleplay', style: TextInputStyle.Short, max: 100 }
        : field === 'serverInvite'
            ? { title: 'Server Invite', label: 'Permanent Discord invite', placeholder: 'https://discord.gg/example', style: TextInputStyle.Short, max: 200 }
            : { title: 'Advertisement', label: 'Advertisement text', placeholder: 'Enter the advertisement exactly as it should be posted.', style: TextInputStyle.Paragraph, max: 1800 };

    const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(config.label)
        .setPlaceholder(config.placeholder)
        .setStyle(config.style)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(config.max);

    return new ModalBuilder()
        .setCustomId(`paid-ad:modal:${field}:${adId}`)
        .setTitle(config.title)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handlePaidAdButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'marketplace:claim') {
        await claimPaidAd(interaction);
        return true;
    }
    const match = interaction.customId.match(/^paid-ad:field:(serverName|serverInvite|advertisement):(\d{8})$/);
    if (!match) return false;
    const field = match[1] as SetupField;
    const adId = match[2];
    const ad = await PaidAd.findOne({ adId }).lean().exec().catch(() => null);
    if (!ad || ad.userId !== interaction.user.id || ad.status !== 'Setup') {
        await interaction.reply({ content: 'This paid-ad setup button is no longer available to you.', flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.showModal(setupModal(field, adId));
    return true;
}

export async function handlePaidAdModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^paid-ad:modal:(serverName|serverInvite|advertisement):(\d{8})$/);
    if (!match) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const field = match[1] as SetupField;
    const adId = match[2];
    const value = interaction.fields.getTextInputValue('value').trim();

    const ad = await PaidAd.findOne({ adId }).lean().exec().catch(() => null);
    if (!ad || ad.userId !== interaction.user.id || ad.status !== 'Setup') {
        await interaction.editReply('This paid-ad setup is no longer available to you.');
        return true;
    }
    if (field === 'serverInvite' && !/^https?:\/\/(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i.test(value)) {
        await interaction.editReply('Please submit a valid Discord invite link.');
        return true;
    }

    const updated = await PaidAd.findOneAndUpdate(
        { adId, userId: interaction.user.id, status: 'Setup' },
        { $set: { [field]: value, updatedAt: new Date() } },
        { new: true },
    ).lean().exec();
    if (!updated) {
        await interaction.editReply('I could not save that information. Please try again.');
        return true;
    }

    let current = updated as unknown as PaidAdRecord;
    await updateSetupMessage(interaction.client, current);
    current = await completeSetupIfReady(interaction.client, current);
    const labels: Record<SetupField, string> = {
        serverName: 'Server name',
        serverInvite: 'Server invite',
        advertisement: 'Advertisement',
    };
    await interaction.editReply(
        current.status === 'Scheduled'
            ? `✅ ${labels[field]} saved. Your setup is complete and advertisement **${current.adId}** has been scheduled.`
            : `✅ ${labels[field]} saved.`,
    );
    return true;
}

async function postPaidAd(client: Client, adId: string, instantById?: string): Promise<{ ok: true; ad: PaidAdRecord } | { ok: false; message: string }> {
    const locked = await PaidAd.findOneAndUpdate(
        { adId, status: 'Scheduled' },
        { $set: { status: 'Posting', updatedAt: new Date(), ...(instantById ? { instantPostedById: instantById } : {}) } },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!locked) return { ok: false, message: 'That advertisement is no longer waiting to be posted.' };
    const ad = locked as unknown as PaidAdRecord;
    if (!isComplete(ad)) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Setup', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'That advertisement setup is incomplete.' };
    }

    const channel = await client.channels.fetch(PAID_AD_POST_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Scheduled', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'The paid-ad posting channel is unavailable.' };
    }

    const ping = ad.pingType === 'everyone' ? '@everyone' : '@here';
    const body = [
        ping,
        '',
        ad.advertisement!,
        '',
        `**Server:** ${ad.serverName}`,
        `**Invite:** ${ad.serverInvite}`,
    ].join('\n');
    const message = await channel.send({
        content: body,
        allowedMentions: { parse: ['everyone'] },
    }).catch(() => null);
    if (!message) {
        await PaidAd.updateOne({ adId }, { $set: { status: 'Scheduled', updatedAt: new Date() } }).exec().catch(() => undefined);
        return { ok: false, message: 'Discord could not post the advertisement.' };
    }

    const final = await PaidAd.findOneAndUpdate(
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
    const posted = final as unknown as PaidAdRecord;
    await paidAdLog(client, instantById ? '⚡ Paid Advertisement Instant Posted' : '✅ Paid Advertisement Posted', [
        `**Advertisement ID:** ${posted.adId}`,
        `**Customer:** <@${posted.userId}>`,
        `**Ping:** @${posted.pingType}`,
        `**Server:** ${posted.serverName}`,
        instantById ? `**Posted By:** <@${instantById}>` : '**Posted By:** Automatic scheduler',
        `**Message:** ${message.url}`,
    ], 0x22c55e);
    return { ok: true, ad: posted };
}

async function executeMyPaidAd(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !isDatabaseAvailable()) {
        await sendV2Reply(interaction, buildSimplePanel('⚠️ Paid Ads Unavailable', ['Paid-ad records are temporarily unavailable.'], 0xf59e0b));
        return;
    }
    const ads = await PaidAd.find({ guildId: interaction.guildId, userId: interaction.user.id })
        .sort({ claimedAt: -1 })
        .limit(10)
        .lean().exec();
    if (!ads.length) {
        await sendV2Reply(interaction, buildSimplePanel('📣 My Paid Ads', ['You do not have any paid-ad claims yet.']));
        return;
    }
    const lines = ads.map(raw => {
        const ad = raw as unknown as PaidAdRecord;
        const when = ad.scheduledAt ? `<t:${Math.floor(new Date(ad.scheduledAt).getTime() / 1000)}:F>` : 'Not scheduled yet';
        return [
            `**Advertisement ${ad.adId}**`,
            `Status: **${ad.status}** • Ping: **@${ad.pingType}**`,
            `Posting Date: ${ad.status === 'Posted' && ad.postedAt ? `<t:${Math.floor(new Date(ad.postedAt).getTime() / 1000)}:F>` : when}`,
            ad.serverName ? `Server: ${ad.serverName}` : 'Server: Waiting for setup',
        ].join('\n');
    });
    await sendV2Reply(interaction, buildSimplePanel('📣 My Paid Ads', lines));
}

async function executeInstantPost(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await canManagePaidAds(interaction)) {
        await sendV2Reply(interaction, buildSimplePanel('🔒 Instant Post Denied', [`You need <@&${PAID_AD_MANAGEMENT_ROLE_ID}> or an authorized bot-management role.`], 0xef4444));
        return;
    }
    if (!interaction.guildId || !isDatabaseAvailable()) {
        await sendV2Reply(interaction, buildSimplePanel('⚠️ Instant Post Unavailable', ['Paid-ad records are temporarily unavailable.'], 0xf59e0b));
        return;
    }
    const ads = await PaidAd.find({ guildId: interaction.guildId, status: 'Scheduled' })
        .sort({ scheduledAt: 1 })
        .limit(25)
        .lean().exec();
    if (!ads.length) {
        await sendV2Reply(interaction, buildSimplePanel('⚡ Instant Post', ['There are no scheduled paid advertisements waiting to be posted.']));
        return;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('paid-ad:instant-select')
        .setPlaceholder('Choose a paid advertisement')
        .addOptions(ads.map(raw => {
            const ad = raw as unknown as PaidAdRecord;
            return {
                label: `${ad.serverName || 'Paid Advertisement'} — ${ad.adId}`.slice(0, 100),
                value: ad.adId,
                description: `@${ad.pingType} • ${ad.scheduledAt ? new Date(ad.scheduledAt).toLocaleDateString('en-US', { timeZone: EASTERN_TIME_ZONE }) : 'No date'}`.slice(0, 100),
            };
        }));
    const panel = basePanel('⚡ Instant Post', 'Choose any scheduled advertisement below. It will post immediately and be removed from the scheduled queue.')
        .addSeparatorComponents(divider())
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
        .addMediaGalleryComponents(underbannerGallery());
    await sendV2Reply(interaction, panel);
}

export async function handlePaidAdSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'paid-ad:instant-select') return false;
    await interaction.deferUpdate();
    if (!await canManagePaidAds(interaction)) {
        await sendV2Reply(interaction, buildSimplePanel('🔒 Instant Post Denied', ['You no longer have permission to use Instant Post.'], 0xef4444));
        return true;
    }
    const adId = interaction.values[0];
    const result = await postPaidAd(interaction.client, adId, interaction.user.id);
    await sendV2Reply(
        interaction,
        result.ok
            ? buildSimplePanel('✅ Advertisement Posted', [`Advertisement **${result.ad.adId}** was posted immediately in <#${PAID_AD_POST_CHANNEL_ID}>.`], 0x22c55e)
            : buildSimplePanel('❌ Instant Post Failed', [result.message], 0xef4444),
    );
    return true;
}

export async function runDuePaidAds(client: Client): Promise<void> {
    if (!isDatabaseAvailable()) return;
    const due = await PaidAd.find({ status: 'Scheduled', scheduledAt: { $lte: new Date() } })
        .sort({ scheduledAt: 1 })
        .limit(5)
        .lean().exec().catch(() => []);
    for (const raw of due) {
        const ad = raw as unknown as PaidAdRecord;
        const result = await postPaidAd(client, ad.adId);
        if (!result.ok) logger.warn(`[PaidAd] Scheduled post ${ad.adId} failed: ${result.message}`);
    }
}

export function startPaidAdScheduler(client: Client): void {
    if (paidAdScheduler) clearInterval(paidAdScheduler);
    void runDuePaidAds(client).catch(error => {
        logger.warn(`[PaidAd] Startup scheduler check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    paidAdScheduler = setInterval(() => {
        void runDuePaidAds(client).catch(error => {
            logger.warn(`[PaidAd] Scheduler check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }, SCHEDULER_INTERVAL_MS);
    logger.info('Paid advertisement scheduler active: one Saturday 12:00 PM Eastern slot per week.');
}

export function stopPaidAdScheduler(): void {
    if (!paidAdScheduler) return;
    clearInterval(paidAdScheduler);
    paidAdScheduler = null;
}

export const paidAdCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('my-paid-ad')
            .setDescription('View your paid advertisement status and posting date')
            .setDMPermission(false),
        execute: executeMyPaidAd,
    },
    {
        data: new SlashCommandBuilder()
            .setName('instant-post')
            .setDescription('Staff: instantly post any scheduled paid advertisement')
            .setDMPermission(false),
        execute: executeInstantPost,
    },
];
