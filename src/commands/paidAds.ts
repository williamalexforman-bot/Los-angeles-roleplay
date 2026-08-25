import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { MarketplaceClaim, PaidAd, type PaidAdRecord } from '../database/marketplaceModels';
import { isPaidAdProduct, marketplaceProduct, paidAdProducts } from '../services/marketplacePurchaseService';
import { logger } from '../utils/logger';
import { decodeMarketplaceTicketMetadata } from './marketplace';

const PAID_AD_BANNER_NAME = 'paid-ad-banner.png';
const PAID_AD_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PAID_AD_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const PUBLISHING_LEASE_MS = 2 * 60_000;
const SCHEDULER_INTERVAL_MS = 15_000;
const registeredClients = new WeakSet<Client>();
let queueMutation: Promise<void> = Promise.resolve();

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(PAID_AD_BANNER_PATH, { name: PAID_AD_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function compact(value: string, max: number): string {
    const clean = value.replace(/```/g, "'''").trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function suppressBroadcastMentions(value: string): string {
    return value.replace(/@(everyone|here)/gi, '@\u200b$1');
}

function discordTimestamp(date: Date, style: 'F' | 'R'): string {
    return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function positiveMinutes(name: string, fallback: number): number {
    const configured = Number(process.env[name]);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

function initialDelayMs(): number {
    return positiveMinutes('PAID_AD_INITIAL_DELAY_MINUTES', 60) * 60_000;
}

function queueIntervalMs(): number {
    return positiveMinutes('PAID_AD_INTERVAL_MINUTES', 24 * 60) * 60_000;
}

function inviteIsValid(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && (url.hostname === 'discord.gg' || url.hostname === 'discord.com')
            && (url.hostname === 'discord.gg' || url.pathname.startsWith('/invite/'));
    } catch {
        return false;
    }
}

function adForm(productKey: string): ModalBuilder {
    const product = marketplaceProduct(productKey);
    return new ModalBuilder()
        .setCustomId(`paid-ad:create:${productKey}`)
        .setTitle((product?.label || 'Create Paid Ad').slice(0, 45))
        .addComponents(
            new TextInputBuilder()
                .setCustomId('server_name')
                .setLabel('Server name')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(true),
            new TextInputBuilder()
                .setCustomId('invite_link')
                .setLabel('Permanent Discord invite')
                .setPlaceholder('https://discord.gg/example')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(500)
                .setRequired(true),
            new TextInputBuilder()
                .setCustomId('server_ad')
                .setLabel('Full advertisement')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(4_000)
                .setRequired(true),
        );
}

function ticketContext(interaction: ChatInputCommandInteraction | ModalSubmitInteraction) {
    const channel = interaction.channel;
    if (!channel || !('topic' in channel)) return null;
    return decodeMarketplaceTicketMetadata(channel.topic);
}

function userOwnsTicket(
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
    ownerId: string,
): boolean {
    return interaction.user.id === ownerId;
}

async function withQueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queueMutation;
    let release!: () => void;
    queueMutation = new Promise<void>(resolvePromise => { release = resolvePromise; });
    await previous;
    try {
        return await operation();
    } finally {
        release();
    }
}

async function nextScheduleDate(guildId: string): Promise<Date> {
    const now = Date.now();
    const earliest = now + initialDelayMs();
    const latest = await PaidAd.findOne({ guildId, status: 'scheduled' })
        .sort({ scheduledFor: -1 })
        .select({ scheduledFor: 1 })
        .lean()
        .exec();
    return new Date(Math.max(earliest, latest ? latest.scheduledFor.getTime() + queueIntervalMs() : 0));
}

function scheduledPanel(ad: PaidAdRecord): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x3b82f6)
        .addMediaGalleryComponents(media(PAID_AD_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 📅 Paid Advertisement Scheduled',
            `> **Ad ID:** \`${ad.adId}\``,
            `> **Product:** ${ad.productLabel}`,
            `> **Server:** ${compact(ad.serverName, 100)}`,
            `> **Scheduled:** ${discordTimestamp(ad.scheduledFor, 'F')} (${discordTimestamp(ad.scheduledFor, 'R')})`,
            `> **Ping:** \`@${ad.pingType}\``,
            '',
            'Use `/paid-ad priority` or `/paid-ad instant` with this Ad ID if you have the matching unused add-on.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export function buildPublishedPaidAdPanel(ad: Pick<PaidAdRecord,
    'adId' | 'serverName' | 'inviteLink' | 'advertisement' | 'pingType' | 'sponsored'
>): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(ad.sponsored ? 0xf59e0b : 0x3b82f6)
        .addMediaGalleryComponents(media(PAID_AD_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `@${ad.pingType}`,
            `## ${ad.sponsored ? '⭐ Sponsored Advertisement' : '📢 Paid Advertisement'}`,
            `### ${suppressBroadcastMentions(compact(ad.serverName, 100))}`,
            `[Join this server](${ad.inviteLink})`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            suppressBroadcastMentions(compact(ad.advertisement, 4_000)),
        ))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Advertisement ID: \`${ad.adId}\``))
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function queuePanel(ads: readonly PaidAdRecord[]): ContainerBuilder {
    const body = ads.length
        ? ads.map((ad, index) => [
            `### ${index + 1}. ${ad.serverName}`,
            `> \`${ad.adId}\` • ${ad.productLabel}`,
            `> ${discordTimestamp(ad.scheduledFor, 'F')} (${discordTimestamp(ad.scheduledFor, 'R')})${ad.priority ? ' • **Priority**' : ''}`,
        ].join('\n')).join('\n')
        : 'There are no scheduled advertisements in this claim ticket.';
    return new ContainerBuilder()
        .setAccentColor(0x3b82f6)
        .addMediaGalleryComponents(media(PAID_AD_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Paid Ad Queue\n${body}`.slice(0, 4_000)))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function createPaidAd(interaction: ModalSubmitInteraction, productKey: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The paid-ad queue is temporarily unavailable while secure storage reconnects.');
        return;
    }
    const metadata = ticketContext(interaction);
    if (!metadata || !interaction.guildId || !userOwnsTicket(interaction, metadata.ownerId)) {
        await interaction.editReply('This form must be submitted by the buyer inside their marketplace Management ticket.');
        return;
    }
    const product = marketplaceProduct(productKey);
    if (!product || !isPaidAdProduct(product)) {
        await interaction.editReply('That paid-ad product is invalid.');
        return;
    }

    const serverName = interaction.fields.getTextInputValue('server_name').trim();
    const inviteLink = interaction.fields.getTextInputValue('invite_link').trim();
    const advertisement = interaction.fields.getTextInputValue('server_ad').trim();
    if (!inviteIsValid(inviteLink)) {
        await interaction.editReply('Please provide a permanent Discord invite such as `https://discord.gg/example`.');
        return;
    }

    await withQueueMutation(async () => {
        const adId = randomUUID();
        const now = new Date();
        const claim = await MarketplaceClaim.findOneAndUpdate(
            {
                guildId: interaction.guildId,
                discordUserId: metadata.ownerId,
                robloxUserId: metadata.marketplace.robloxUserId,
                productKey,
                status: 'available',
            },
            {
                $set: {
                    status: 'consumed',
                    consumedByAdId: adId,
                    consumedAt: now,
                    updatedAt: now,
                },
            },
            { new: true },
        ).lean().exec();
        if (!claim) {
            await interaction.editReply(`This ticket does not have an unused **${product.label}** purchase.`);
            return;
        }

        let ad: PaidAdRecord;
        try {
            const scheduledFor = await nextScheduleDate(interaction.guildId!);
            ad = (await PaidAd.create({
                adId,
                guildId: interaction.guildId,
                ownerDiscordId: metadata.ownerId,
                robloxUserId: metadata.marketplace.robloxUserId,
                ticketChannelId: interaction.channelId,
                baseClaimId: claim.claimId,
                productKey: product.key,
                productLabel: product.label,
                pingType: product.pingType,
                sponsored: product.sponsored,
                serverName,
                inviteLink,
                advertisement,
                status: 'scheduled',
                priority: false,
                instant: false,
                scheduledFor,
                createdAt: now,
                updatedAt: now,
            })).toObject();
        } catch (error) {
            await MarketplaceClaim.updateOne(
                { claimId: claim.claimId, consumedByAdId: adId },
                { $set: { status: 'available', updatedAt: new Date() }, $unset: { consumedByAdId: 1, consumedAt: 1 } },
            ).exec().catch(() => undefined);
            throw error;
        }

        if (interaction.channel?.isSendable()) {
            await interaction.channel.send({
                components: [scheduledPanel(ad)],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            }).catch(error => {
                logger.warn(`[PaidAds] Could not send the scheduled-ad confirmation for ${ad.adId}: ${String(error)}`);
            });
        }
        await interaction.editReply(`✅ Your advertisement is scheduled for ${discordTimestamp(ad.scheduledFor, 'F')}. Ad ID: \`${ad.adId}\``);
    });
}

async function outputChannel(client: Client) {
    const channelId = process.env.PAID_AD_OUTPUT_CHANNEL_ID || '1538624666313170964';
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

async function findExistingPublishedMessage(
    destination: Awaited<ReturnType<typeof outputChannel>>,
    adId: string,
    botUserId: string,
) {
    if (!destination || !('messages' in destination)) return null;
    const recent = await destination.messages.fetch({ limit: 100 }).catch(() => null);
    return recent?.find(message => message.author.id === botUserId
        && JSON.stringify(message.components.map(component => component.toJSON())).includes(adId)) || null;
}

async function markPublished(adId: string, channelId: string, messageId: string): Promise<void> {
    const publishedAt = new Date();
    await PaidAd.updateOne(
        { adId, status: 'publishing' },
        {
            $set: {
                status: 'published',
                publishedAt,
                publishedChannelId: channelId,
                publishedMessageId: messageId,
                updatedAt: publishedAt,
            },
            $unset: { processingStartedAt: 1, failureReason: 1 },
        },
    ).exec();
}

async function publishPaidAdUnlocked(client: Client, adId: string, force = false): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PUBLISHING_LEASE_MS);
    const scheduledFilter: Record<string, unknown> = { status: 'scheduled' };
    if (!force) scheduledFilter.scheduledFor = { $lte: now };
    const claimed = await PaidAd.findOneAndUpdate(
        {
            adId,
            $or: [
                scheduledFilter,
                { status: 'publishing', processingStartedAt: { $lte: staleBefore } },
            ],
        },
        { $set: { status: 'publishing', processingStartedAt: now, updatedAt: now } },
        { new: true },
    ).lean().exec();
    if (!claimed) return false;

    try {
        const destination = await outputChannel(client);
        if (!destination) throw new Error('Paid-ad output channel is unavailable.');
        const existing = await findExistingPublishedMessage(destination, adId, client.user?.id || '');
        if (existing) {
            await markPublished(adId, existing.channelId, existing.id);
            logger.info(`[PaidAds] Recovered already-published ${adId} without sending a duplicate.`);
            return true;
        }
        const message = await destination.send({
            components: [buildPublishedPaidAdPanel(claimed)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: ['everyone'], users: [], roles: [] },
        });
        await markPublished(adId, message.channelId, message.id);
        const user = await client.users.fetch(claimed.ownerDiscordId).catch(() => null);
        await user?.send(`✅ Your paid advertisement for **${claimed.serverName}** was published: ${message.url}`).catch(() => undefined);
        logger.info(`[PaidAds] Published ${adId} in ${message.channelId} with @${claimed.pingType}.`);
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await PaidAd.updateOne(
            { adId, status: 'publishing' },
            {
                $set: {
                    status: 'scheduled',
                    failureReason: reason.slice(0, 500),
                    scheduledFor: new Date(Date.now() + 5 * 60_000),
                    updatedAt: new Date(),
                },
                $unset: { processingStartedAt: 1 },
            },
        ).exec().catch(() => undefined);
        logger.error(`[PaidAds] Could not publish ${adId}: ${reason}`);
        return false;
    }
}

async function publishPaidAd(client: Client, adId: string, force = false): Promise<boolean> {
    return withQueueMutation(() => publishPaidAdUnlocked(client, adId, force));
}

async function useInstantPost(interaction: ChatInputCommandInteraction, adId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The paid-ad queue is temporarily unavailable while secure storage reconnects.');
        return;
    }
    const metadata = ticketContext(interaction);
    if (!metadata || !interaction.guildId || !userOwnsTicket(interaction, metadata.ownerId)) {
        await interaction.editReply('Use this command in your marketplace Management ticket.');
        return;
    }
    const ad = await PaidAd.findOne({
        adId,
        guildId: interaction.guildId,
        ownerDiscordId: metadata.ownerId,
        robloxUserId: metadata.marketplace.robloxUserId,
        status: 'scheduled',
    }).lean().exec();
    if (!ad) {
        await interaction.editReply('That scheduled Ad ID was not found for this verified marketplace account.');
        return;
    }
    const claim = await MarketplaceClaim.findOneAndUpdate(
        {
            guildId: interaction.guildId,
            discordUserId: metadata.ownerId,
            robloxUserId: metadata.marketplace.robloxUserId,
            productKey: 'instant-post',
            status: 'available',
        },
        {
            $set: {
                status: 'consumed',
                consumedByAdId: adId,
                consumedAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { new: true },
    ).lean().exec();
    if (!claim) {
        await interaction.editReply('This ticket does not have an unused **Instant Post** purchase.');
        return;
    }
    const published = await publishPaidAd(interaction.client, adId, true);
    if (!published) {
        await MarketplaceClaim.updateOne(
            { claimId: claim.claimId, consumedByAdId: adId },
            { $set: { status: 'available', updatedAt: new Date() }, $unset: { consumedByAdId: 1, consumedAt: 1 } },
        ).exec().catch(() => undefined);
        await interaction.editReply('Instant publishing failed, so your Instant Post was not consumed. The ad remains scheduled.');
        return;
    }
    await PaidAd.updateOne({ adId }, { $set: { instant: true, updatedAt: new Date() } }).exec().catch(error => {
        logger.warn(`[PaidAds] Published ${adId} instantly but could not save the instant flag: ${String(error)}`);
    });
    await interaction.editReply('✅ The advertisement was published immediately and the Instant Post was consumed.');
}

async function usePriority(interaction: ChatInputCommandInteraction, adId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The paid-ad queue is temporarily unavailable while secure storage reconnects.');
        return;
    }
    const metadata = ticketContext(interaction);
    if (!metadata || !interaction.guildId || !userOwnsTicket(interaction, metadata.ownerId)) {
        await interaction.editReply('Use this command in your marketplace Management ticket.');
        return;
    }

    await withQueueMutation(async () => {
        const target = await PaidAd.findOne({
            adId,
            guildId: interaction.guildId,
            ownerDiscordId: metadata.ownerId,
            robloxUserId: metadata.marketplace.robloxUserId,
            status: 'scheduled',
        }).lean().exec();
        if (!target) {
            await interaction.editReply('That scheduled Ad ID was not found for this verified marketplace account.');
            return;
        }
        const first = await PaidAd.findOne({ guildId: interaction.guildId, status: 'scheduled' })
            .sort({ scheduledFor: 1, createdAt: 1 })
            .lean()
            .exec();
        if (!first || first.adId === target.adId) {
            await interaction.editReply('That advertisement is already at the front of the waiting list, so Priority was not consumed.');
            return;
        }
        const claim = await MarketplaceClaim.findOneAndUpdate(
            {
                guildId: interaction.guildId,
                discordUserId: metadata.ownerId,
                robloxUserId: metadata.marketplace.robloxUserId,
                productKey: 'priority',
                status: 'available',
            },
            {
                $set: {
                    status: 'consumed',
                    consumedByAdId: adId,
                    consumedAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            { new: true },
        ).lean().exec();
        if (!claim) {
            await interaction.editReply('This ticket does not have an unused **Priority** purchase.');
            return;
        }
        try {
            await PaidAd.bulkWrite([
                {
                    updateOne: {
                        filter: { adId: target.adId, status: 'scheduled' },
                        update: { $set: { scheduledFor: first.scheduledFor, priority: true, updatedAt: new Date() } },
                    },
                },
                {
                    updateOne: {
                        filter: { adId: first.adId, status: 'scheduled' },
                        update: { $set: { scheduledFor: target.scheduledFor, updatedAt: new Date() } },
                    },
                },
            ]);
        } catch (error) {
            await MarketplaceClaim.updateOne(
                { claimId: claim.claimId, consumedByAdId: adId },
                { $set: { status: 'available', updatedAt: new Date() }, $unset: { consumedByAdId: 1, consumedAt: 1 } },
            ).exec().catch(() => undefined);
            throw error;
        }
        await interaction.editReply(`✅ The advertisement was moved to the front and is now scheduled for ${discordTimestamp(first.scheduledFor, 'F')}.`);
    });
}

async function showQueue(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const metadata = ticketContext(interaction);
    if (!metadata || !interaction.guildId || !userOwnsTicket(interaction, metadata.ownerId)) {
        await interaction.editReply('Use this command in your marketplace Management ticket.');
        return;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The paid-ad queue is temporarily unavailable while secure storage reconnects.');
        return;
    }
    const ads = await PaidAd.find({
        guildId: interaction.guildId,
        ownerDiscordId: metadata.ownerId,
        robloxUserId: metadata.marketplace.robloxUserId,
        status: 'scheduled',
    }).sort({ scheduledFor: 1 }).limit(20).lean().exec();
    await interaction.editReply({
        components: [queuePanel(ads)],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

export async function handlePaidAdModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('paid-ad:create:')) return false;
    const productKey = interaction.customId.slice('paid-ad:create:'.length);
    try {
        await createPaidAd(interaction, productKey);
    } catch (error) {
        logger.error(`[PaidAds] Could not create ad: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (interaction.deferred || interaction.replied) await interaction.editReply('The paid advertisement could not be created. No purchase was consumed; please try again.').catch(() => undefined);
        else await interaction.reply({ content: 'The paid advertisement could not be created. No purchase was consumed; please try again.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return true;
}

export async function processDuePaidAds(client: Client): Promise<number> {
    if (!isDatabaseAvailable()) return 0;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PUBLISHING_LEASE_MS);
    const due = await PaidAd.find({
        $or: [
            { status: 'scheduled', scheduledFor: { $lte: now } },
            { status: 'publishing', processingStartedAt: { $lte: staleBefore } },
        ],
    }).sort({ scheduledFor: 1 }).limit(20).lean().exec();
    let published = 0;
    for (const ad of due) {
        try {
            if (await publishPaidAd(client, ad.adId)) published += 1;
        } catch (error) {
            logger.error(`[PaidAds] Scheduler failed for ${ad.adId}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        }
    }
    return published;
}

export function registerPaidAdScheduler(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    void processDuePaidAds(client);
    const timer = setInterval(() => void processDuePaidAds(client), SCHEDULER_INTERVAL_MS);
    timer.unref?.();
    logger.info('[PaidAds] Durable scheduled publishing enabled.');
}

export const paidAdCommand = {
    data: new SlashCommandBuilder()
        .setName('paid-ad')
        .setDescription('Create and manage a verified paid advertisement')
        .setDMPermission(false)
        .addSubcommand(subcommand => subcommand
            .setName('create')
            .setDescription('Create an advertisement from a verified purchase')
            .addStringOption(option => option
                .setName('product')
                .setDescription('The paid-ad product to consume')
                .setRequired(true)
                .addChoices(...paidAdProducts().map(product => ({ name: product.label, value: product.key })))))
        .addSubcommand(subcommand => subcommand
            .setName('instant')
            .setDescription('Use an Instant Post on a scheduled advertisement')
            .addStringOption(option => option.setName('ad-id').setDescription('Ad ID shown after creation').setRequired(true).setMaxLength(36)))
        .addSubcommand(subcommand => subcommand
            .setName('priority')
            .setDescription('Use Priority to move an ad to the front')
            .addStringOption(option => option.setName('ad-id').setDescription('Ad ID shown after creation').setRequired(true).setMaxLength(36)))
        .addSubcommand(subcommand => subcommand
            .setName('queue')
            .setDescription('View scheduled ads from this purchase ticket')),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'create') {
            const metadata = ticketContext(interaction);
            if (!metadata || !userOwnsTicket(interaction, metadata.ownerId)) {
                await interaction.reply({ content: 'Use this command in your marketplace Management ticket.', flags: MessageFlags.Ephemeral });
                return;
            }
            const productKey = interaction.options.getString('product', true);
            const product = marketplaceProduct(productKey);
            if (!product || !isPaidAdProduct(product)) {
                await interaction.reply({ content: 'That paid-ad product is invalid.', flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.showModal(adForm(productKey));
            return;
        }
        if (subcommand === 'instant') {
            await useInstantPost(interaction, interaction.options.getString('ad-id', true));
            return;
        }
        if (subcommand === 'priority') {
            await usePriority(interaction, interaction.options.getString('ad-id', true));
            return;
        }
        await showQueue(interaction);
    },
};
