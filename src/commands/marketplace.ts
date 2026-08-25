import path from 'node:path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SectionBuilder,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const MARKETPLACE_CHANNEL_ID = '1526035127606706196';
const MARKETPLACE_BANNER_NAME = 'paid-ad-banner.png';
const MARKETPLACE_BANNER_PATH = path.resolve(process.cwd(), 'assets', MARKETPLACE_BANNER_NAME);
const MARKETPLACE_BANNER_URL = `attachment://${MARKETPLACE_BANNER_NAME}`;
const MARKETPLACE_ACCENT_COLOR = 0x3b82f6;

type MarketplaceItem = {
    id: string;
    title: string;
    description: string;
    price: number;
};

const MARKETPLACE_ITEMS: readonly MarketplaceItem[] = [
    { id: 'paid-ad-everyone', title: 'Paid Ad — @everyone', description: 'With an everyone ping, everyone on the server will be notified of your advertisement.', price: 800 },
    { id: 'paid-ad-here', title: 'Paid Ad — @here', description: 'With a here ping, everyone currently online in the server will be notified of your advertisement.', price: 450 },
    { id: 'sponsored-everyone', title: 'Sponsored — @everyone', description: 'Your sponsored post will notify everyone in the server with an everyone ping.', price: 650 },
    { id: 'sponsored-here', title: 'Sponsored — @here', description: 'Your sponsored post will notify everyone currently online with a here ping.', price: 350 },
    { id: 'instant-post', title: 'Instant Post', description: 'Your advertisement is posted immediately without waiting in the standard queue.', price: 1_500 },
    { id: 'priority', title: 'Priority', description: 'Your advertisement is moved ahead of standard posts in the priority queue.', price: 1_000 },
];

function marketplaceGallery(url: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
}

function priceButton(item: MarketplaceItem): ButtonBuilder {
    return new ButtonBuilder().setCustomId(`marketplace:price:${item.id}`).setLabel(`${item.price}`).setEmoji('💠').setStyle(ButtonStyle.Secondary).setDisabled(true);
}

function marketplaceItemSection(item: MarketplaceItem): SectionBuilder {
    return new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${item.title}**\n${item.description}`)).setButtonAccessory(priceButton(item));
}

function buildMarketplacePanel(): ContainerBuilder {
    const claimButton = new ButtonBuilder().setCustomId('marketplace:claim').setLabel('Claim Purchase').setStyle(ButtonStyle.Primary);
    const panel = new ContainerBuilder()
        .setAccentColor(MARKETPLACE_ACCENT_COLOR)
        .addMediaGalleryComponents(marketplaceGallery(MARKETPLACE_BANNER_URL))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Marketplace\nWe have a marketplace that allows you to support us and receive something in return! All purchases are final, with no refunds being made under any circumstances. Chargeback fraud relating to USD purchases will result in a permanent ban.'));
    for (const item of MARKETPLACE_ITEMS) panel.addSectionComponents(marketplaceItemSection(item));
    return panel.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton)).addMediaGalleryComponents(marketplaceGallery(BOTTOM_UNDERBANNER));
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

async function canPostMarketplace(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const botPermissionsRoleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(botPermissionsRoleId && member.roles.cache.has(botPermissionsRoleId));
}

export const marketplacePanelCommand = {
    data: new SlashCommandBuilder().setName('marketplace-panel').setDescription('Post the Marketplace V2 panel in the marketplace channel'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await canPostMarketplace(interaction)) { await interaction.editReply('You do not have permission to post the marketplace panel.'); return; }
        const channel = await interaction.client.channels.fetch(MARKETPLACE_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) { await interaction.editReply(`I could not access <#${MARKETPLACE_CHANNEL_ID}>. Make sure I can View Channel and Send Messages there.`); return; }
        try {
            await channel.send(buildMarketplacePanelRefreshPayload());
            await interaction.editReply(`✅ Marketplace V2 panel posted in <#${MARKETPLACE_CHANNEL_ID}>.`);
        } catch (error) {
            logger.error(`[Marketplace] Failed to post panel: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await interaction.editReply('I could not post the marketplace panel. Check my channel permissions and make sure the paid-ad banner asset exists.');
        }
    },
};
