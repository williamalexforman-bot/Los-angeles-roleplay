import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
    type Guild,
    type TextChannel,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { MarketplaceClaim } from '../database/marketplaceModels';
import { resolveMelonlyRobloxProfile, type MelonlyRobloxProfile } from '../services/melonlyVerificationService';
import {
    marketplaceProduct,
    marketplaceProducts,
    ownedMarketplaceProducts,
    robloxUserOwnsConfiguredItem,
    type MarketplaceProductConfig,
} from '../services/marketplacePurchaseService';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const MARKETPLACE_CHANNEL_ID = '1526035127606706196';
const MARKETPLACE_MANAGEMENT_CATEGORY_ID = process.env.MARKETPLACE_MANAGEMENT_CATEGORY_ID || '1526254462128099479';
const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const MARKETPLACE_BANNER_NAME = 'paid-ad-banner.png';
const MARKETPLACE_BANNER_PATH = path.resolve(process.cwd(), 'assets', MARKETPLACE_BANNER_NAME);
const MARKETPLACE_BANNER_URL = `attachment://${MARKETPLACE_BANNER_NAME}`;
const MARKETPLACE_ACCENT_COLOR = 0x3b82f6;

export interface MarketplaceTicketMetadata {
    ownerId: string;
    type: 'management';
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
    marketplace: {
        claimIds: string[];
        robloxUserId: string;
    };
}

function marketplaceGallery(url: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

type MarketplaceCategory = 'donations' | 'paid-ads';

export function marketplaceCategoryProducts(category: MarketplaceCategory): MarketplaceProductConfig[] {
    return marketplaceProducts().filter(product => category === 'donations'
        ? product.kind === 'donation'
        : product.kind === 'paid-ad' || product.kind === 'add-on');
}

function categorySelect(): StringSelectMenuBuilder {
    return new StringSelectMenuBuilder()
        .setCustomId('marketplace:browse')
        .setPlaceholder('Choose what you want to buy')
        .addOptions(
            {
                label: 'Donations',
                value: 'donations',
                description: 'Small, medium, large, and extra large donations',
                emoji: '💝',
            },
            {
                label: 'Paid Ads',
                value: 'paid-ads',
                description: 'Paid ads, sponsored ads, Instant Post, and Priority',
                emoji: '📣',
            },
        );
}

function productSelect(category: MarketplaceCategory, selectedKey?: string): StringSelectMenuBuilder {
    return new StringSelectMenuBuilder()
        .setCustomId(`marketplace:products:${category}`)
        .setPlaceholder(category === 'donations' ? 'Choose a donation' : 'Choose a paid-ad product')
        .addOptions(marketplaceCategoryProducts(category).map(product => ({
            label: `${product.label} — R$${product.price.toLocaleString()}`,
            value: product.key,
            description: product.description.slice(0, 100),
            default: product.key === selectedKey,
        })));
}

export function buildMarketplacePanel(): ContainerBuilder {
    const claimButton = new ButtonBuilder()
        .setCustomId('marketplace:claim')
        .setLabel('Claim Purchase')
        .setEmoji('🛍️')
        .setStyle(ButtonStyle.Primary);
    const panel = new ContainerBuilder()
        .setAccentColor(MARKETPLACE_ACCENT_COLOR)
        .addMediaGalleryComponents(marketplaceGallery(MARKETPLACE_BANNER_URL))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            "## Hello! Welcome to Los Angeles Roleplay's Marketplace",
            'Use the dropdown menu below to browse the items you can buy.',
            '',
            '### How to claim a purchase',
            '1. Buy an item through its Roblox purchase button.',
            '2. Press **Claim Purchase** below the dropdown menu.',
            '3. Select the purchase you want to claim from your verified inventory.',
            '4. Obey all marketplace rules and wait for a staff member to handle your claim.',
            '',
            'Please claim only purchases you made. Thank you!',
        ].join('\n')));
    return panel
        .addSeparatorComponents(separator())
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect()))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(marketplaceGallery(BOTTOM_UNDERBANNER));
}

function marketplaceAttachments(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(MARKETPLACE_BANNER_PATH, { name: MARKETPLACE_BANNER_NAME }),
        new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.png' }),
    ];
}

export function buildMarketplacePanelRefreshPayload() {
    return {
        components: [buildMarketplacePanel()],
        files: marketplaceAttachments(),
        flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] as [] },
    };
}

function safeChannelName(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25) || 'buyer';
}

export function encodeMarketplaceTicketMetadata(metadata: MarketplaceTicketMetadata): string {
    return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`;
}

export function decodeMarketplaceTicketMetadata(topic?: string | null): MarketplaceTicketMetadata | null {
    if (!topic?.startsWith('larp-ticket:')) return null;
    try {
        const parsed = JSON.parse(
            Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8'),
        ) as MarketplaceTicketMetadata;
        if (parsed.type !== 'management'
            || !/^\d{17,20}$/.test(parsed.ownerId)
            || !parsed.marketplace
            || !/^\d+$/.test(parsed.marketplace.robloxUserId)
            || !Array.isArray(parsed.marketplace.claimIds)
            || !parsed.marketplace.claimIds.length) return null;
        return parsed;
    } catch {
        return null;
    }
}

function marketplaceTicketPanel(
    userId: string,
    profile: MelonlyRobloxProfile,
    products: readonly MarketplaceProductConfig[],
    staffRoleIds: readonly string[],
): ContainerBuilder {
    const identity = profile.username
        ? `[@${profile.username}](https://www.roblox.com/users/${profile.robloxId}/profile) (\`${profile.robloxId}\`)`
        : `[Roblox account ${profile.robloxId}](https://www.roblox.com/users/${profile.robloxId}/profile)`;
    const instructions: string[] = [];
    if (products.some(product => product.kind === 'paid-ad')) {
        instructions.push('To submit an advertisement, use `/paid-ad create` in this ticket and choose the paid-ad product you claimed.');
    }
    if (products.some(product => product.kind === 'add-on')) {
        instructions.push('For **Instant Post** or **Priority**, create your ad first, then use the matching `/paid-ad` command with its Ad ID.');
    }
    if (products.some(product => product.kind === 'donation')) {
        instructions.push('Please wait here for a marketplace staff member to review and handle your donation claim.');
    }
    const details = [
        [...staffRoleIds.map(roleId => `<@&${roleId}>`), `<@${userId}>`].join(' • '),
        '## 🛍️ Marketplace Purchase Claim',
        `> **Melonly Verified Roblox:** ${identity}`,
        '> **Purchase Check:** `Passed`',
        '',
        '### Purchased Items',
        ...products.map(product => `• **${product.label}** — Game Pass \`${product.itemId}\``),
        '',
        ...instructions,
    ].join('\n');

    return new ContainerBuilder()
        .setAccentColor(MARKETPLACE_ACCENT_COLOR)
        .addMediaGalleryComponents(marketplaceGallery(MARKETPLACE_BANNER_URL))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim Ticket').setEmoji('🙋').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket:close-request').setLabel('Request Close').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        ))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(marketplaceGallery(BOTTOM_UNDERBANNER));
}

async function marketplaceStaffRoleIds(guild: Guild): Promise<string[]> {
    const configured = [...new Set([
        TICKET_SUPPORT_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value && /^\d{17,20}$/.test(value))))];
    const roles = await guild.roles.fetch().catch(error => {
        logger.warn(`[Marketplace] Could not refresh guild roles before ticket creation: ${error instanceof Error ? error.message : String(error)}`);
        return guild.roles.cache;
    });
    const existing = configured.filter(roleId => roles.has(roleId));
    const stale = configured.filter(roleId => !roles.has(roleId));
    if (stale.length) logger.warn(`[Marketplace] Ignoring missing marketplace staff role IDs: ${stale.join(', ')}`);
    return existing;
}

async function createManagementTicket(
    guild: Guild,
    userId: string,
    username: string,
    profile: MelonlyRobloxProfile,
    products: readonly MarketplaceProductConfig[],
    claimIds: string[],
): Promise<TextChannel> {
    const metadata: MarketplaceTicketMetadata = {
        ownerId: userId,
        type: 'management',
        createdAt: new Date().toISOString(),
        marketplace: { claimIds, robloxUserId: profile.robloxId },
    };
    const staffRoleIds = await marketplaceStaffRoleIds(guild);
    const staffOverwrites = staffRoleIds.map(roleId => ({
        id: roleId,
        allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
        ],
    }));
    const channel = await guild.channels.create({
        name: `marketplace-${safeChannelName(profile.username || username)}-${userId.slice(-4)}`.slice(0, 50),
        type: ChannelType.GuildText,
        parent: MARKETPLACE_MANAGEMENT_CATEGORY_ID,
        topic: encodeMarketplaceTicketMetadata(metadata),
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
                id: userId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            ...staffOverwrites,
            {
                id: guild.client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages,
                ],
            },
        ],
        reason: `Verified marketplace claim by ${username} (${userId})`,
    });

    try {
        const panelMessage = await channel.send({
            components: [marketplaceTicketPanel(userId, profile, products, staffRoleIds)],
            files: marketplaceAttachments(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [userId], roles: staffRoleIds },
        });
        metadata.panelMessageId = panelMessage.id;
        await channel.setTopic(encodeMarketplaceTicketMetadata(metadata), 'Marketplace claim panel linked');
        return channel;
    } catch (error) {
        await channel.delete('Marketplace claim setup failed.').catch(() => undefined);
        throw error;
    }
}

function isDuplicateKeyError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 11000);
}

function isMarketplaceCategory(value: string): value is MarketplaceCategory {
    return value === 'donations' || value === 'paid-ads';
}

function categoryName(category: MarketplaceCategory): string {
    return category === 'donations' ? 'Donations' : 'Paid Ads';
}

async function browseMarketplaceCategory(interaction: StringSelectMenuInteraction): Promise<void> {
    const category = interaction.values[0];
    if (!isMarketplaceCategory(category)) {
        await interaction.reply({ content: 'That marketplace category is not available.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply({
        content: `## ${categoryName(category)}\nChoose a product below to view its price and Roblox purchase link.`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(productSelect(category))],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
}

async function showMarketplaceProduct(interaction: StringSelectMenuInteraction): Promise<void> {
    const category = interaction.customId.slice('marketplace:products:'.length);
    const product = marketplaceProduct(interaction.values[0]);
    if (!isMarketplaceCategory(category)
        || !product
        || !marketplaceCategoryProducts(category).some(candidate => candidate.key === product.key)) {
        await interaction.update({ content: 'That marketplace product is no longer available.', components: [] });
        return;
    }
    const buyButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(product.purchaseUrl)
        .setLabel(`Buy ${product.label} • R$${product.price.toLocaleString()}`);
    await interaction.update({
        content: [
            `## ${product.label}`,
            product.description,
            '',
            `**Price:** R$${product.price.toLocaleString()}`,
            'After buying, return to the marketplace panel and press **Claim Purchase**.',
        ].join('\n'),
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(productSelect(category, product.key)),
            new ActionRowBuilder<ButtonBuilder>().addComponents(buyButton),
        ],
        allowedMentions: { parse: [] },
    });
}

const ALREADY_CLAIMED_MESSAGE = 'You have already claimed this. If you feel this is an issue, please open a support ticket.';

async function showMarketplaceClaimChoices(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.guildId) {
        await interaction.editReply('Marketplace purchases can only be claimed inside the server.');
        return;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply('Purchase claims are temporarily unavailable while secure storage reconnects. No entitlement was used; please try again shortly.');
        return;
    }

    const verification = await resolveMelonlyRobloxProfile(interaction.user.id);
    if (!verification.ok) {
        await interaction.editReply(`${verification.message} Verify with Melonly, then try **Claim Purchase** again.`);
        return;
    }

    const ownership = await ownedMarketplaceProducts(verification.profile.robloxId);
    if (ownership.failures.length) {
        logger.warn(`[Marketplace] Roblox ownership checks failed for ${interaction.user.id}: ${ownership.failures.join(' | ')}`);
        await interaction.editReply('Roblox could not verify every marketplace item right now. Nothing was claimed; please try again shortly.');
        return;
    }
    if (!ownership.products.length) {
        await interaction.editReply(`I checked ${verification.profile.username ? `**@${verification.profile.username}**` : `Roblox ID \`${verification.profile.robloxId}\``}, but it does not own any listed marketplace game pass.`);
        return;
    }

    try {
        const existingClaims = await MarketplaceClaim.find({
            guildId: interaction.guildId,
            productKey: { $in: ownership.products.map(product => product.key) },
            $or: [
                { discordUserId: interaction.user.id },
                { robloxUserId: verification.profile.robloxId },
            ],
        }).select({ productKey: 1 }).lean().exec();
        const claimedKeys = new Set(existingClaims.map(claim => claim.productKey));
        const claimSelect = new StringSelectMenuBuilder()
            .setCustomId('marketplace:claim-select')
            .setPlaceholder('Select the purchase you want to claim')
            .addOptions(ownership.products.map(product => ({
                label: `${product.label} — R$${product.price.toLocaleString()}`,
                value: product.key,
                description: claimedKeys.has(product.key)
                    ? 'Already claimed — open a support ticket if this is incorrect'
                    : 'Verified in your Roblox inventory — ready to claim',
            })));
        await interaction.editReply({
            content: [
                '## Select a Purchase to Claim',
                `Roblox inventory checked for ${verification.profile.username ? `**@${verification.profile.username}**` : `ID \`${verification.profile.robloxId}\``}.`,
                'Choose one purchase below. A marketplace Management ticket will be opened for staff to handle it.',
            ].join('\n'),
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(claimSelect)],
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        logger.error(`[Marketplace] Could not prepare claim choices for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Your purchases were found, but the secure claim list could not be loaded. Nothing was claimed; please try again shortly.');
    }
}

async function claimSelectedMarketplacePurchase(interaction: StringSelectMenuInteraction): Promise<void> {
    await interaction.deferUpdate();
    if (!interaction.guild || !interaction.guildId) {
        await interaction.editReply({ content: 'Marketplace purchases can only be claimed inside the server.', components: [] });
        return;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply({ content: 'Purchase claims are temporarily unavailable while secure storage reconnects. Nothing was claimed; please try again shortly.', components: [] });
        return;
    }
    const product = marketplaceProduct(interaction.values[0]);
    if (!product) {
        await interaction.editReply({ content: 'That marketplace purchase is no longer available.', components: [] });
        return;
    }
    const verification = await resolveMelonlyRobloxProfile(interaction.user.id);
    if (!verification.ok) {
        await interaction.editReply({ content: `${verification.message} Verify with Melonly, then try **Claim Purchase** again.`, components: [] });
        return;
    }
    const ownership = await robloxUserOwnsConfiguredItem(verification.profile.robloxId, product);
    if (!ownership.ok) {
        logger.warn(`[Marketplace] Roblox ownership check failed for ${interaction.user.id} and ${product.key}: ${ownership.message}`);
        await interaction.editReply({ content: 'Roblox could not verify that purchase right now. Nothing was claimed; please try again shortly.', components: [] });
        return;
    }
    if (!ownership.owned) {
        await interaction.editReply({ content: `I could not find **${product.label}** in your verified Roblox inventory.`, components: [] });
        return;
    }

    const existingClaim = await MarketplaceClaim.findOne({
        guildId: interaction.guildId,
        productKey: product.key,
        $or: [
            { discordUserId: interaction.user.id },
            { robloxUserId: verification.profile.robloxId },
        ],
    }).lean().exec();
    if (existingClaim) {
        await interaction.editReply({ content: ALREADY_CLAIMED_MESSAGE, components: [] });
        return;
    }

    const claimId = randomUUID();
    const now = new Date();
    try {
        await MarketplaceClaim.create({
            claimId,
            guildId: interaction.guildId,
            discordUserId: interaction.user.id,
            robloxUserId: verification.profile.robloxId,
            robloxUsername: verification.profile.username || undefined,
            productKey: product.key,
            itemId: product.itemId,
            status: 'available',
            claimedAt: now,
            createdAt: now,
            updatedAt: now,
        });
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            await interaction.editReply({ content: ALREADY_CLAIMED_MESSAGE, components: [] });
            return;
        }
        logger.error(`[Marketplace] Could not persist ${product.key} claim for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply({ content: 'Your purchase was found, but the secure claim record could not be saved. Nothing was claimed; please try again shortly.', components: [] });
        return;
    }

    let channel: TextChannel | null = null;
    try {
        channel = await createManagementTicket(
            interaction.guild,
            interaction.user.id,
            interaction.user.username,
            verification.profile,
            [product],
            [claimId],
        );
        await MarketplaceClaim.updateOne(
            { claimId },
            { $set: { ticketChannelId: channel.id, updatedAt: new Date() } },
        ).exec();
        await interaction.editReply({ content: `✅ **${product.label}** was verified. Your Management ticket is ready: <#${channel.id}>`, components: [] });
    } catch (error) {
        if (channel) await channel.delete('Marketplace claim setup failed.').catch(() => undefined);
        await MarketplaceClaim.deleteOne({ claimId }).exec().catch(() => undefined);
        logger.error(`[Marketplace] Could not create claim ticket for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply({ content: 'Your purchase was verified, but I could not create the Management ticket. Nothing was claimed; check my category permissions and try again.', components: [] });
    }
}

export async function handleMarketplaceButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'marketplace:claim') return false;
    await showMarketplaceClaimChoices(interaction);
    return true;
}

export async function handleMarketplaceSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId === 'marketplace:browse') {
        await browseMarketplaceCategory(interaction);
        return true;
    }
    if (interaction.customId.startsWith('marketplace:products:')) {
        await showMarketplaceProduct(interaction);
        return true;
    }
    if (interaction.customId === 'marketplace:claim-select') {
        await claimSelectedMarketplacePurchase(interaction);
        return true;
    }
    return false;
}

async function canPostMarketplace(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const botPermissionsRoleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(botPermissionsRoleId && member.roles.cache.has(botPermissionsRoleId));
}

export const marketplacePanelCommand = {
    data: new SlashCommandBuilder()
        .setName('marketplace-panel')
        .setDescription('Post the Marketplace V2 panel in the marketplace channel'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await canPostMarketplace(interaction)) {
            await interaction.editReply('You do not have permission to post the marketplace panel.');
            return;
        }
        const channel = await interaction.client.channels.fetch(MARKETPLACE_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply(`I could not access <#${MARKETPLACE_CHANNEL_ID}>. Make sure I can View Channel and Send Messages there.`);
            return;
        }
        try {
            await channel.send(buildMarketplacePanelRefreshPayload());
            await interaction.editReply(`✅ Marketplace V2 panel posted in <#${MARKETPLACE_CHANNEL_ID}>.`);
        } catch (error) {
            logger.error(`[Marketplace] Failed to post panel: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await interaction.editReply('I could not post the marketplace panel. Check my channel permissions and make sure the paid-ad banner asset exists.');
        }
    },
};
