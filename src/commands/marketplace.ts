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
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
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

function purchaseButton(product: MarketplaceProductConfig): ButtonBuilder {
    return new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(product.purchaseUrl)
        .setLabel(`Buy • R$${product.price.toLocaleString()}`);
}

function marketplaceItemSection(product: MarketplaceProductConfig): SectionBuilder {
    return new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**${product.label}**\n${product.description}`,
        ))
        .setButtonAccessory(purchaseButton(product));
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
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Marketplace',
            'Purchase an item through its Roblox button, then select **Claim Purchase**. Your Melonly-verified Roblox account and inventory will be checked automatically.',
            '',
            'All purchases are final. Chargeback fraud may result in a permanent ban.',
        ].join('\n')));
    for (const product of marketplaceProducts()) panel.addSectionComponents(marketplaceItemSection(product));
    return panel
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton))
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
): ContainerBuilder {
    const identity = profile.username
        ? `[@${profile.username}](https://www.roblox.com/users/${profile.robloxId}/profile) (\`${profile.robloxId}\`)`
        : `[Roblox account ${profile.robloxId}](https://www.roblox.com/users/${profile.robloxId}/profile)`;
    const details = [
        `<@&${TICKET_SUPPORT_ROLE_ID}> • <@${userId}>`,
        '## 🛍️ Marketplace Purchase Claim',
        `> **Melonly Verified Roblox:** ${identity}`,
        '> **Purchase Check:** `Passed`',
        '',
        '### Purchased Items',
        ...products.map(product => `• **${product.label}** — Game Pass \`${product.itemId}\``),
        '',
        'To submit an advertisement, use `/paid-ad create` in this ticket and choose one of your paid-ad products.',
        'If you also claimed **Instant Post** or **Priority**, create the ad first and then use the matching `/paid-ad` command.',
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

function marketplaceStaffRoleIds(): string[] {
    return [...new Set([
        TICKET_SUPPORT_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value && /^\d{17,20}$/.test(value))))];
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
    const staffOverwrites = marketplaceStaffRoleIds().map(roleId => ({
        id: roleId,
        allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
        ],
    }));
    const channel = await guild.channels.create({
        name: `paid-ad-${safeChannelName(profile.username || username)}-${userId.slice(-4)}`.slice(0, 50),
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
                    PermissionFlagsBits.MentionEveryone,
                ],
            },
        ],
        reason: `Verified marketplace claim by ${username} (${userId})`,
    });

    try {
        const panelMessage = await channel.send({
            components: [marketplaceTicketPanel(userId, profile, products)],
            files: marketplaceAttachments(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [userId], roles: marketplaceStaffRoleIds() },
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

async function persistNewClaims(
    guildId: string,
    userId: string,
    profile: MelonlyRobloxProfile,
    ownedProducts: readonly MarketplaceProductConfig[],
): Promise<{ claimIds: string[]; products: MarketplaceProductConfig[] }> {
    const claimIds: string[] = [];
    const products: MarketplaceProductConfig[] = [];
    for (const product of ownedProducts) {
        const claimId = randomUUID();
        try {
            await MarketplaceClaim.create({
                claimId,
                guildId,
                discordUserId: userId,
                robloxUserId: profile.robloxId,
                robloxUsername: profile.username || undefined,
                productKey: product.key,
                itemId: product.itemId,
                status: 'available',
                claimedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            claimIds.push(claimId);
            products.push(product);
        } catch (error) {
            if (!isDuplicateKeyError(error)) {
                if (claimIds.length) await MarketplaceClaim.deleteMany({ claimId: { $in: claimIds } }).exec();
                throw error;
            }
        }
    }
    return { claimIds, products };
}

async function claimMarketplacePurchase(interaction: ButtonInteraction): Promise<void> {
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

    let created: { claimIds: string[]; products: MarketplaceProductConfig[] };
    try {
        created = await persistNewClaims(
            interaction.guildId,
            interaction.user.id,
            verification.profile,
            ownership.products,
        );
    } catch (error) {
        logger.error(`[Marketplace] Could not persist claim for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Your purchase was found, but the secure claim record could not be saved. Nothing was consumed; please try again shortly.');
        return;
    }
    if (!created.claimIds.length) {
        const existingClaims = await MarketplaceClaim.find({
            guildId: interaction.guildId,
            robloxUserId: verification.profile.robloxId,
            productKey: { $in: ownership.products.map(product => product.key) },
        }).lean().exec();
        const existingChannelId = existingClaims.find(claim => claim.ticketChannelId)?.ticketChannelId;
        const existingChannel = existingChannelId
            ? await interaction.guild.channels.fetch(existingChannelId).catch(() => null)
            : null;
        if (existingChannel) {
            await interaction.editReply(`Those purchases were already claimed in <#${existingChannel.id}>.`);
            return;
        }

        const availableClaims = existingClaims.filter(claim => claim.status === 'available');
        const availableProducts = availableClaims
            .map(claim => marketplaceProduct(claim.productKey))
            .filter((product): product is MarketplaceProductConfig => Boolean(product));
        if (!availableClaims.length || !availableProducts.length) {
            await interaction.editReply('Those purchases were already claimed and used. Contact Management if you need help with a completed claim.');
            return;
        }
        let reopened: TextChannel | null = null;
        try {
            reopened = await createManagementTicket(
                interaction.guild,
                interaction.user.id,
                interaction.user.username,
                verification.profile,
                availableProducts,
                availableClaims.map(claim => claim.claimId),
            );
            await MarketplaceClaim.updateMany(
                { claimId: { $in: availableClaims.map(claim => claim.claimId) } },
                { $set: { ticketChannelId: reopened.id, updatedAt: new Date() } },
            ).exec();
            await interaction.editReply(`✅ Your unused purchases were already verified, so I reopened their Management ticket: <#${reopened.id}>`);
        } catch (error) {
            if (reopened) await reopened.delete('Marketplace claim reopen failed.').catch(() => undefined);
            logger.error(`[Marketplace] Could not reopen claim ticket for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await interaction.editReply('Your purchases are verified, but I could not reopen the Management ticket. Check my category permissions and try again.');
        }
        return;
    }

    let channel: TextChannel | null = null;
    try {
        channel = await createManagementTicket(
            interaction.guild,
            interaction.user.id,
            interaction.user.username,
            verification.profile,
            created.products,
            created.claimIds,
        );
        await MarketplaceClaim.updateMany(
            { claimId: { $in: created.claimIds } },
            { $set: { ticketChannelId: channel.id, updatedAt: new Date() } },
        ).exec();
        await interaction.editReply(`✅ Purchase verified. Your Management ticket is ready: <#${channel.id}>`);
    } catch (error) {
        if (channel) await channel.delete('Marketplace claim setup failed.').catch(() => undefined);
        await MarketplaceClaim.deleteMany({ claimId: { $in: created.claimIds } }).exec().catch(() => undefined);
        logger.error(`[Marketplace] Could not create claim ticket for ${interaction.user.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        await interaction.editReply('Your purchase was verified, but I could not create the Management ticket. Nothing was consumed; check my category permissions and try again.');
    }
}

export async function handleMarketplaceButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== 'marketplace:claim') return false;
    await claimMarketplacePurchase(interaction);
    return true;
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
