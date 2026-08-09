import {
    ActionRowBuilder,
    APIEmbedField,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    Message,
    ModalSubmitInteraction,
    SlashCommandBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
    User,
} from 'discord.js';
import { EconomyAccount, EconomyListing, EconomyTransaction } from '../database/models';
import { BRAND, CASINO_CHANNEL_ID, CASINO_ENABLED, ECONOMY_ADMIN_ROLE_ID, ECONOMY_CHANNEL_ID, ECONOMY_LOG_CHANNEL_ID, ECONOMY_PREFIX } from '../config/constants';
import { sendToChannel } from '../utils/notify';
import { logger } from '../utils/logger';

const activeGames = new Map<string, EconomyBlackjackSession>();
const economyCommandAliases = new Map<string, string>([
    ['bal', 'balance'],
    ['eco', 'economy'],
    ['prof', 'profile'],
    ['nw', 'networth'],
    ['lvl', 'level'],
    ['dep', 'deposit'],
    ['with', 'withdraw'],
    ['tx', 'transactions'],
    ['bj', 'blackjack'],
    ['cf', 'coinflip'],
]);

const defaultEconomyConfig = {
    startingCash: 2500,
    startingBank: 10000,
    dailyReward: 750,
    weeklyReward: 5000,
    workCooldownSeconds: 2700,
    dailyCooldownSeconds: 86400,
    weeklyCooldownSeconds: 604800,
    bankInterestRate: 0.025,
    maxBalance: 10_000_000,
    shopItems: [
        { id: 'phone', name: 'Smartphone', price: 350, type: 'item', description: 'A modern phone with apps.', value: 250 },
        { id: 'repair_kit', name: 'Repair Kit', price: 250, type: 'item', description: 'Repairs vehicles and gear.', value: 150 },
        { id: 'event_ticket', name: 'Event Ticket', price: 100, type: 'item', description: 'Access to exclusive events.', value: 90 },
        { id: 'gold_bar', name: 'Gold Bar', price: 5000, type: 'item', description: 'Valuable collectible.', value: 4800 },
    ],
    vehicles: [
        { id: 'charger', name: '2026 Dodge Charger', price: 45000, value: 42000, description: 'A sporty cruiser with style.' },
        { id: 'suburban', name: 'Luxury SUV', price: 55000, value: 52000, description: 'Spacious and powerful.' },
        { id: 'bike', name: 'Motorcycle', price: 18000, value: 17000, description: 'Fast and nimble ride.' },
    ],
    properties: [
        { id: 'downtown_residence', name: 'Downtown Residence', price: 250000, value: 250000, location: 'Downtown', rent: 2000 },
        { id: 'suburban_home', name: 'Suburban Home', price: 150000, value: 150000, location: 'Suburb', rent: 1200 },
        { id: 'office_suite', name: 'Office Suite', price: 350000, value: 350000, location: 'Business District', rent: 5000 },
    ],
    jobs: [
        { id: 'police', name: 'Police Officer', salary: 850, xp: 125, requiredLevel: 5, description: 'Protects the city and enforces the law.' },
        { id: 'firefighter', name: 'Firefighter', salary: 780, xp: 110, requiredLevel: 4, description: 'Responds to fires and rescues civilians.' },
        { id: 'paramedic', name: 'Paramedic', salary: 820, xp: 120, requiredLevel: 4, description: 'Heals injured citizens and navigates emergencies.' },
        { id: 'mechanic', name: 'Mechanic', salary: 650, xp: 90, requiredLevel: 3, description: 'Fixes vehicles and upgrades performance.' },
        { id: 'taxi', name: 'Taxi Driver', salary: 520, xp: 70, requiredLevel: 2, description: 'Transports citizens around town.' },
        { id: 'truck', name: 'Truck Driver', salary: 720, xp: 95, requiredLevel: 3, description: 'Delivers cargo across the city.' },
        { id: 'delivery', name: 'Delivery Driver', salary: 600, xp: 80, requiredLevel: 2, description: 'Delivers goods quickly and reliably.' },
        { id: 'store_clerk', name: 'Store Clerk', salary: 480, xp: 60, requiredLevel: 1, description: 'Stocks shelves and assists customers.' },
        { id: 'construction', name: 'Construction Worker', salary: 700, xp: 100, requiredLevel: 3, description: 'Builds the city and improves structures.' },
        { id: 'banker', name: 'Bank Employee', salary: 900, xp: 130, requiredLevel: 5, description: 'Manages accounts and provides financial services.' },
        { id: 'restaurant', name: 'Restaurant Worker', salary: 540, xp: 65, requiredLevel: 1, description: 'Serves meals and keeps guests happy.' },
        { id: 'business_owner', name: 'Business Owner', salary: 1100, xp: 150, requiredLevel: 8, description: 'Runs a successful enterprise in the city.' },
    ],
};

const sharedButtons = {
    balance: new ButtonBuilder().setCustomId('economy_balance').setLabel('💰 Balance').setStyle(ButtonStyle.Primary),
    bank: new ButtonBuilder().setCustomId('economy_bank').setLabel('🏦 Bank').setStyle(ButtonStyle.Primary),
    jobs: new ButtonBuilder().setCustomId('economy_jobs').setLabel('💼 Jobs').setStyle(ButtonStyle.Primary),
    shop: new ButtonBuilder().setCustomId('economy_shop').setLabel('🛒 Shop').setStyle(ButtonStyle.Primary),
    inventory: new ButtonBuilder().setCustomId('economy_inventory').setLabel('🎒 Inventory').setStyle(ButtonStyle.Primary),
    vehicles: new ButtonBuilder().setCustomId('economy_vehicles').setLabel('🚗 Vehicles').setStyle(ButtonStyle.Primary),
    properties: new ButtonBuilder().setCustomId('economy_properties').setLabel('🏠 Properties').setStyle(ButtonStyle.Primary),
    marketplace: new ButtonBuilder().setCustomId('economy_marketplace').setLabel('🏪 Marketplace').setStyle(ButtonStyle.Primary),
    casino: new ButtonBuilder().setCustomId('economy_casino').setLabel('🎰 Casino').setStyle(ButtonStyle.Primary),
    achievements: new ButtonBuilder().setCustomId('economy_achievements').setLabel('🏆 Achievements').setStyle(ButtonStyle.Primary),
};

const actionRowForEconomyLinks = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(sharedButtons.balance, sharedButtons.bank, sharedButtons.jobs, sharedButtons.shop, sharedButtons.inventory);

const actionRowForEconomyLinksRow2 = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(sharedButtons.vehicles, sharedButtons.properties, sharedButtons.marketplace, sharedButtons.casino, sharedButtons.achievements);

interface EconomyInventoryItem {
    itemId: string;
    name: string;
    quantity: number;
}

interface EconomyVehicleRecord {
    vehicleId: string;
    name: string;
    value: number;
    condition: number;
    level: number;
    insured: boolean;
    purchasedAt: Date;
}

interface EconomyPropertyRecord {
    propertyId: string;
    name: string;
    value: number;
    location: string;
    upgraded: number;
    rent: number;
    purchasedAt: Date;
}

interface EconomyCasinoStats {
    blackjackGames: number;
    blackjackWins: number;
    slotsGames: number;
    rouletteGames: number;
    diceGames: number;
    coinflipGames: number;
    pokerGames: number;
    highlowGames: number;
    totalWins: number;
    totalLosses: number;
}

interface EconomyAccountDocument {
    guildId: string;
    discordId: string;
    cash: number;
    bank: number;
    xp: number;
    level: number;
    jobId: string;
    jobName: string;
    jobLevel: number;
    jobXp: number;
    dailyStreak: number;
    weeklyStreak: number;
    lastDailyClaim: Date | null;
    lastWeeklyClaim: Date | null;
    lastWorkAt: Date | null;
    nextWorkAt: Date | null;
    pendingPay: number;
    achievements: string[];
    inventory: EconomyInventoryItem[];
    vehicles: EconomyVehicleRecord[];
    properties: EconomyPropertyRecord[];
    casinoStats: EconomyCasinoStats;
    economyBan: boolean;
    lastInterestAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    save(): Promise<this>;
}

interface EconomyBlackjackSession {
    userId: string;
    guildId: string;
    playerCards: BlackjackCard[];
    dealerCards: BlackjackCard[];
    wager: number;
    messageId: string;
}

interface BlackjackCard {
    label: string;
    value: number;
}

function formatCurrency(amount: number): string {
    const formatted = Math.abs(amount).toLocaleString('en-US');
    return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function normalizeAmount(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    const amount = Math.trunc(value);
    return amount > 0 ? amount : null;
}

function parseNumber(value: string): number | null {
    if (!value) return null;
    const parsed = Number(value.replace(/[,\$]/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function canUseEconomyChannel(channelId: string): boolean {
    return [ECONOMY_CHANNEL_ID, CASINO_CHANNEL_ID].includes(channelId);
}

function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createTransactionId(): string {
    return `TXN-${Math.random().toString(36).substring(2, 8).toUpperCase()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

function makeEconomyEmbed(title: string, description: string, fields: APIEmbedField[], footer?: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(title)
        .setDescription(description)
        .addFields(fields)
        .setFooter({ text: footer ?? BRAND.footer })
        .setTimestamp();
}

async function logEconomyAction(client: any, embed: EmbedBuilder): Promise<void> {
    try {
        await sendToChannel(client, ECONOMY_LOG_CHANNEL_ID, embed);
    } catch (error) {
        logger.warn(`Economy log failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function getEconomyAccount(guildId: string, discordId: string): Promise<EconomyAccountDocument> {
    const existing = await EconomyAccount.findOne({ guildId, discordId }).exec();
    if (existing) return existing as EconomyAccountDocument;

    const account = new EconomyAccount({
        guildId,
        discordId,
        cash: defaultEconomyConfig.startingCash,
        bank: defaultEconomyConfig.startingBank,
        xp: 0,
        level: 1,
        jobId: 'unemployed',
        jobName: 'Unemployed',
        jobLevel: 0,
        jobXp: 0,
        dailyStreak: 0,
        weeklyStreak: 0,
        lastDailyClaim: null,
        lastWeeklyClaim: null,
        lastWorkAt: null,
        nextWorkAt: null,
        pendingPay: 0,
        achievements: [],
        inventory: [],
        vehicles: [],
        properties: [],
        casinoStats: {
            blackjackGames: 0,
            blackjackWins: 0,
            slotsGames: 0,
            rouletteGames: 0,
            diceGames: 0,
            coinflipGames: 0,
            pokerGames: 0,
            highlowGames: 0,
            totalWins: 0,
            totalLosses: 0,
        },
        economyBan: false,
        lastInterestAt: null,
    });
    await account.save();
    return account as EconomyAccountDocument;
}

async function commitTransaction(
    guildId: string,
    discordId: string,
    type: string,
    amount: number,
    senderId: string | null,
    recipientId: string | null,
    metadata: Record<string, unknown>,
): Promise<void> {
    const account = await getEconomyAccount(guildId, discordId);
    const balanceAfter = account.cash + account.bank;
    const transaction = new EconomyTransaction({
        guildId,
        discordId,
        transactionId: createTransactionId(),
        type,
        amount,
        senderId,
        recipientId,
        balanceAfter,
        metadata,
    });
    await transaction.save();
}

async function applyBalanceChange(account: EconomyAccountDocument, deltaCash: number, reason: string, issuerId?: string): Promise<EconomyAccountDocument> {
    account.cash += deltaCash;
    if (account.cash < 0) account.cash = 0;
    account.updatedAt = new Date();
    await account.save();
    await commitTransaction(account.guildId, account.discordId, reason, deltaCash, issuerId ?? null, account.discordId, {});
    return account;
}

function hasEconomyAdminRole(member: GuildMember | null | undefined): boolean {
    if (!member) return false;
    return member.roles.cache.has(ECONOMY_ADMIN_ROLE_ID) || member.permissions.has('Administrator');
}

function parseTargetUser(message: Message, argument: string | undefined): User | null {
    if (!argument) return message.author;
    const mentionMatch = argument.match(/^<@!?(\d+)>$/u);
    const id = mentionMatch ? mentionMatch[1] : argument.replace(/\D/g, '');
    return message.client.users.cache.get(id) ?? null;
}

function drawCard(): BlackjackCard {
    const ranks: BlackjackCard[] = [
        { label: 'A', value: 11 },
        { label: '2', value: 2 },
        { label: '3', value: 3 },
        { label: '4', value: 4 },
        { label: '5', value: 5 },
        { label: '6', value: 6 },
        { label: '7', value: 7 },
        { label: '8', value: 8 },
        { label: '9', value: 9 },
        { label: '10', value: 10 },
        { label: 'J', value: 10 },
        { label: 'Q', value: 10 },
        { label: 'K', value: 10 },
    ];
    return ranks[getRandomInt(0, ranks.length - 1)];
}

function calculateHand(cards: BlackjackCard[]): number {
    let total = cards.reduce((sum, card) => sum + card.value, 0);
    let aces = cards.filter(card => card.label === 'A').length;
    while (total > 21 && aces > 0) {
        total -= 10;
        aces -= 1;
    }
    return total;
}

function renderBlackjackEmbed(session: EconomyBlackjackSession, revealDealer: boolean): EmbedBuilder {
    const playerTotal = calculateHand(session.playerCards);
    const dealerTotal = revealDealer ? calculateHand(session.dealerCards) : calculateHand([session.dealerCards[0]]);
    const playerCards = session.playerCards.map(card => card.label).join(' ');
    const dealerCards = revealDealer ? session.dealerCards.map(card => card.label).join(' ') : `${session.dealerCards[0].label} ?`;
    return makeEconomyEmbed('🃏 BLACKJACK', `Wager: ${formatCurrency(session.wager)}`, [
        { name: '🎩 Dealer', value: `${dealerCards}\nValue: ${revealDealer ? dealerTotal : '??'}`, inline: true },
        { name: '👤 Player', value: `${playerCards}\nValue: ${playerTotal}`, inline: true },
    ]);
}

function buildBlackjackButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`blackjack_hit:${userId}`).setLabel('🃏 HIT').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`blackjack_stand:${userId}`).setLabel('✋ STAND').setStyle(ButtonStyle.Danger),
    );
}

async function finishBlackjack(interaction: ButtonInteraction, session: EconomyBlackjackSession, playerWins: boolean, account: EconomyAccountDocument): Promise<void> {
    const revealEmbed = renderBlackjackEmbed(session, true);
    if (playerWins) {
        account.cash += session.wager;
        account.casinoStats.blackjackGames += 1;
        account.casinoStats.blackjackWins += 1;
        account.casinoStats.totalWins += 1;
        await account.save();
        await commitTransaction(account.guildId, account.discordId, 'BLACKJACK_WIN', session.wager, account.discordId, account.discordId, { wager: session.wager });
        await interaction.update({ embeds: [revealEmbed.setDescription(`🏆 PLAYER WINS — +${formatCurrency(session.wager)}`)], components: [] });
    } else {
        account.cash -= session.wager;
        if (account.cash < 0) account.cash = 0;
        account.casinoStats.blackjackGames += 1;
        account.casinoStats.totalLosses += 1;
        await account.save();
        await commitTransaction(account.guildId, account.discordId, 'BLACKJACK_LOSS', -session.wager, account.discordId, null, { wager: session.wager });
        await interaction.update({ embeds: [revealEmbed.setDescription(`💥 BUST — You lost ${formatCurrency(session.wager)}`)], components: [] });
    }
    activeGames.delete(session.userId);
}

async function handleEconomyButtons(interaction: ButtonInteraction): Promise<boolean> {
    const [action, targetUserId] = interaction.customId.split(':');
    if (targetUserId && targetUserId !== interaction.user.id) {
        await interaction.reply({ content: '❌ NOT YOUR GAME\nYou cannot control another player\'s active economy session.', ephemeral: true });
        return true;
    }
    switch (action) {
        case 'economy_balance':
        case 'economy_bank':
        case 'economy_jobs':
        case 'economy_shop':
        case 'economy_inventory':
        case 'economy_vehicles':
        case 'economy_properties':
        case 'economy_marketplace':
        case 'economy_casino':
        case 'economy_achievements': {
            if (!interaction.guildId) return false;
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const dashboard = buildEconomyDashboard(account, interaction.user);
            let embed = dashboard.embed;
            if (action === 'economy_balance' || action === 'economy_bank') {
                embed = buildBalanceEmbed(account, interaction.user);
            } else if (action === 'economy_jobs') {
                embed = makeEconomyEmbed('💼 JOBS', 'View available jobs and your current role.', [
                    { name: 'Current Job', value: account.jobName, inline: true },
                    { name: 'Salary', value: formatCurrency(defaultEconomyConfig.jobs.find(job => job.id === account.jobId)?.salary ?? 0), inline: true },
                    { name: 'Next Shift Bonus', value: formatCurrency(defaultEconomyConfig.jobs.find(job => job.id === account.jobId)?.xp ?? 0), inline: true },
                ]);
            }
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return true;
        }
        case 'blackjack_hit':
        case 'blackjack_stand': {
            const session = activeGames.get(interaction.user.id);
            if (!session) {
                await interaction.reply({ content: '🎮 GAME ALREADY ACTIVE\nNo active blackjack game was found.', ephemeral: true });
                return true;
            }
            await handleBlackjackAction(interaction, session, action === 'blackjack_hit');
            return true;
        }
        default:
            return false;
    }
}

async function handleEconomySelection(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (!interaction.guildId || !interaction.customId.startsWith('economy_select')) return false;
    const selection = interaction.values[0];
    const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
    let embed: EmbedBuilder;
    switch (selection) {
        case 'overview':
            embed = buildProfileEmbed(account, interaction.user);
            break;
        case 'assets':
            embed = makeEconomyEmbed('🏠 ASSETS', 'Your vehicles, properties, and inventory.', [
                { name: 'Vehicles', value: `${account.vehicles.length}`, inline: true },
                { name: 'Properties', value: `${account.properties.length}`, inline: true },
                { name: 'Inventory', value: `${account.inventory.reduce((sum, item) => sum + item.quantity, 0)} items`, inline: true },
            ]);
            break;
        case 'jobs':
            embed = makeEconomyEmbed('💼 JOBS', 'Your current job progress.', [
                { name: 'Current Job', value: account.jobName, inline: true },
                { name: 'Job Level', value: `${account.jobLevel}`, inline: true },
                { name: 'Job XP', value: `${account.jobXp}`, inline: true },
            ]);
            break;
        case 'achievements':
            embed = makeEconomyEmbed('🏆 ACHIEVEMENTS', 'Your unlocked economy achievements.', [
                { name: 'Achievements', value: account.achievements.length ? account.achievements.join('\n') : 'None yet', inline: false },
            ]);
            break;
        case 'casino':
            embed = makeEconomyEmbed('🎰 CASINO', 'Your casino statistics.', [
                { name: 'Blackjack Wins', value: `${account.casinoStats.blackjackWins}`, inline: true },
                { name: 'Slots Played', value: `${account.casinoStats.slotsGames}`, inline: true },
                { name: 'Total Wins', value: `${account.casinoStats.totalWins}`, inline: true },
            ]);
            break;
        default:
            return false;
    }
    await interaction.update({ embeds: [embed], components: [] });
    return true;
}

async function handleEconomyModals(interaction: ModalSubmitInteraction): Promise<boolean> {
    return false;
}

function buildEconomyDashboard(account: EconomyAccountDocument, user: User): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
    const netWorth = account.cash + account.bank + account.vehicles.reduce((sum, vehicle) => sum + vehicle.value, 0) + account.properties.reduce((sum, property) => sum + property.value, 0);
    const fields: APIEmbedField[] = [
        { name: '👤 Account', value: `<@${user.id}>`, inline: true },
        { name: '💵 Cash', value: formatCurrency(account.cash), inline: true },
        { name: '🏦 Bank', value: formatCurrency(account.bank), inline: true },
        { name: '💎 Net Worth', value: formatCurrency(netWorth), inline: true },
        { name: '⭐ Level', value: `${account.level}`, inline: true },
        { name: '⭐ XP', value: `${account.xp} / ${account.level * 1000}`, inline: true },
        { name: '💼 Job', value: account.jobName, inline: true },
    ];
    return { embed: makeEconomyEmbed('💰 LARP ECONOMY', 'Your central economy dashboard.', fields), components: [actionRowForEconomyLinks, actionRowForEconomyLinksRow2] };
}

function buildBalanceEmbed(account: EconomyAccountDocument, user: User): EmbedBuilder {
    const netWorth = account.cash + account.bank + account.vehicles.reduce((sum, vehicle) => sum + vehicle.value, 0) + account.properties.reduce((sum, property) => sum + property.value, 0);
    const fields: APIEmbedField[] = [
        { name: '💵 Cash', value: formatCurrency(account.cash), inline: true },
        { name: '🏦 Bank', value: formatCurrency(account.bank), inline: true },
        { name: '💎 Net Worth', value: formatCurrency(netWorth), inline: true },
        { name: '⭐ Level', value: `${account.level}`, inline: true },
        { name: '⭐ XP', value: `${account.xp} / ${account.level * 1000}`, inline: true },
        { name: '💼 Current Job', value: account.jobName, inline: true },
    ];
    return makeEconomyEmbed('💰 ACCOUNT BALANCE', `<@${user.id}>'s balance summary.`, fields, 'Economy system powered by Los Angeles Roleplay');
}

function buildProfileEmbed(account: EconomyAccountDocument, user: User): EmbedBuilder {
    const createdAt = `<t:${Math.floor(account.createdAt.getTime() / 1000)}:D>`;
    const netWorth = account.cash + account.bank + account.vehicles.reduce((sum, vehicle) => sum + vehicle.value, 0) + account.properties.reduce((sum, property) => sum + property.value, 0);
    const fields: APIEmbedField[] = [
        { name: 'Username', value: user.tag, inline: true },
        { name: 'User ID', value: user.id, inline: true },
        { name: 'Account Created', value: createdAt, inline: true },
        { name: 'Cash', value: formatCurrency(account.cash), inline: true },
        { name: 'Bank', value: formatCurrency(account.bank), inline: true },
        { name: 'Net Worth', value: formatCurrency(netWorth), inline: true },
        { name: 'Job', value: account.jobName, inline: true },
        { name: 'Job Level', value: `${account.jobLevel}`, inline: true },
        { name: 'XP', value: `${account.xp} / ${account.level * 1000}`, inline: true },
        { name: 'Economy Level', value: `${account.level}`, inline: true },
        { name: 'Vehicles Owned', value: `${account.vehicles.length}`, inline: true },
        { name: 'Properties Owned', value: `${account.properties.length}`, inline: true },
        { name: 'Inventory Items', value: `${account.inventory.reduce((sum, item) => sum + item.quantity, 0)} items`, inline: true },
        { name: 'Achievements', value: `${account.achievements.length}`, inline: true },
        { name: 'Casino Wins', value: `${account.casinoStats.totalWins}`, inline: true },
    ];
    return makeEconomyEmbed('📇 ECONOMY PROFILE', `Detailed economy profile for <@${user.id}>.`, fields);
}

function buildEconomyError(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(0xEF4444).setTitle('❌ ERROR').setDescription(message).setTimestamp();
}

function formatJobLine(job: { name: string; salary: number; requiredLevel: number; xp: number; description: string; }): string {
    return `**${job.name}** — ${job.description}\nSalary: ${formatCurrency(job.salary)} • Required Level: ${job.requiredLevel} • XP/shift: ${job.xp}`;
}

function buildEconomyShopEmbed(account: EconomyAccountDocument): EmbedBuilder {
    const shopLines = defaultEconomyConfig.shopItems.map(item => `**${item.name}** — ${formatCurrency(item.price)}\n${item.description}`).join('\n\n');
    return makeEconomyEmbed('🛒 SHOP', 'Browse the LARP store. Use prefix buy commands to purchase items.', [
        { name: 'Featured Items', value: shopLines, inline: false },
    ]);
}

async function handleBlackjackAction(interaction: ButtonInteraction, session: EconomyBlackjackSession, hit: boolean): Promise<void> {
    const account = await getEconomyAccount(session.guildId, session.userId);
    if (!account || account.economyBan) {
        await interaction.reply({ content: '❌ You are banned from economy actions.', ephemeral: true });
        return;
    }
    if (hit) {
        session.playerCards.push(drawCard());
        const playerTotal = calculateHand(session.playerCards);
        if (playerTotal > 21) {
            await finishBlackjack(interaction, session, false, account);
            return;
        }
        await interaction.update({ embeds: [renderBlackjackEmbed(session, false)], components: [buildBlackjackButtons(session.userId)] });
    } else {
        while (calculateHand(session.dealerCards) < 17) {
            session.dealerCards.push(drawCard());
        }
        const dealerTotal = calculateHand(session.dealerCards);
        const playerTotal = calculateHand(session.playerCards);
        const playerWins = dealerTotal > 21 || playerTotal > dealerTotal;
        await finishBlackjack(interaction, session, playerWins, account);
    }
}

async function handlePrefixEconomyCommand(message: Message): Promise<void> {
    if (!message.guild) return;
    const prefix = ECONOMY_PREFIX;
    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!args.length) return;
    const commandName = economyCommandAliases.get(args[0].toLowerCase()) ?? args[0].toLowerCase();
    const account = await getEconomyAccount(message.guild.id, message.author.id);
    if (account.economyBan) {
        await message.reply({ embeds: [buildEconomyError('You are banned from economy commands.')], allowedMentions: { parse: [] } });
        return;
    }
    switch (commandName) {
        case 'economy':
            await message.reply({ embeds: [buildEconomyDashboard(account, message.author).embed], components: [actionRowForEconomyLinks, actionRowForEconomyLinksRow2], allowedMentions: { parse: [] } });
            return;
        case 'balance':
            await message.reply({ embeds: [buildBalanceEmbed(account, message.author)], allowedMentions: { parse: [] } });
            return;
        case 'profile':
            await message.reply({ embeds: [buildProfileEmbed(account, message.author)], allowedMentions: { parse: [] } });
            return;
        case 'pay': {
            const recipient = parseTargetUser(message, args[1]);
            const amount = parseNumber(args[2] ?? '');
            if (!recipient || !amount || recipient.id === message.author.id || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID PAYMENT\nUsage: $pay @user amount')], allowedMentions: { parse: [] } });
                return;
            }
            const recipientAccount = await getEconomyAccount(message.guild.id, recipient.id);
            account.cash -= amount;
            recipientAccount.cash += amount;
            await account.save();
            await recipientAccount.save();
            await commitTransaction(message.guild.id, account.discordId, 'PAYMENT_OUT', -amount, message.author.id, recipient.id, {});
            await commitTransaction(message.guild.id, recipient.id, 'PAYMENT_IN', amount, message.author.id, recipient.id, {});
            await message.reply({ embeds: [makeEconomyEmbed('💸 PAYMENT CONFIRMED', `Sent ${formatCurrency(amount)} to <@${recipient.id}>.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'rob': {
            const target = parseTargetUser(message, args[1]);
            if (!target || target.id === message.author.id) {
                await message.reply({ embeds: [buildEconomyError('❌ Invalid target to rob.')], allowedMentions: { parse: [] } });
                return;
            }
            const victim = await getEconomyAccount(message.guild.id, target.id);
            const robber = account;
            if (victim.cash < 100) {
                await message.reply({ embeds: [buildEconomyError('❌ Target has too little cash to rob.')], allowedMentions: { parse: [] } });
                return;
            }
            const success = Math.random() < 0.4; // 40% success chance
            if (success) {
                const stolen = Math.max(50, Math.floor(victim.cash * (0.1 + Math.random() * 0.4)));
                const actualStolen = Math.min(stolen, victim.cash);
                victim.cash -= actualStolen;
                robber.cash += actualStolen;
                await victim.save();
                await robber.save();
                await commitTransaction(message.guild.id, robber.discordId, 'ROB_SUCCESS', actualStolen, robber.discordId, victim.discordId, { target: victim.discordId });
                await commitTransaction(message.guild.id, victim.discordId, 'ROBBED', -actualStolen, robber.discordId, victim.discordId, {});
                await message.reply({ embeds: [makeEconomyEmbed('🕵️‍♂️ ROBBERY SUCCESS', `You stole ${formatCurrency(actualStolen)} from <@${target.id}>.`, [])], allowedMentions: { parse: [] } });
            } else {
                const penalty = Math.min(robber.cash, Math.max(25, Math.floor(robber.cash * (0.05 + Math.random() * 0.15))));
                robber.cash -= penalty;
                victim.cash += penalty;
                await robber.save();
                await victim.save();
                await commitTransaction(message.guild.id, robber.discordId, 'ROB_FAIL', -penalty, robber.discordId, victim.discordId, {});
                await commitTransaction(message.guild.id, victim.discordId, 'ROB_DEFENDED', penalty, robber.discordId, victim.discordId, {});
                await message.reply({ embeds: [makeEconomyEmbed('💥 ROBBERY FAILED', `You were caught and lost ${formatCurrency(penalty)} to <@${target.id}>.`, [])], allowedMentions: { parse: [] } });
            }
            return;
        }
        case 'daily': {
            const now = Date.now();
            const last = account.lastDailyClaim?.getTime() ?? 0;
            const next = last + defaultEconomyConfig.dailyCooldownSeconds * 1000;
            if (now < next) {
                await message.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60)} minutes before using this command again.`)], allowedMentions: { parse: [] } });
                return;
            }
            account.lastDailyClaim = new Date(now);
            account.dailyStreak += 1;
            account.cash += defaultEconomyConfig.dailyReward;
            account.xp += 50;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'DAILY_REWARD', defaultEconomyConfig.dailyReward, null, account.discordId, { streak: account.dailyStreak });
            await message.reply({ embeds: [makeEconomyEmbed('🎁 DAILY REWARD', `You received ${formatCurrency(defaultEconomyConfig.dailyReward)}.`, [
                { name: 'Current streak', value: `${account.dailyStreak} days`, inline: true },
                { name: 'XP Earned', value: '+50', inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'weekly': {
            const now = Date.now();
            const last = account.lastWeeklyClaim?.getTime() ?? 0;
            const next = last + defaultEconomyConfig.weeklyCooldownSeconds * 1000;
            if (now < next) {
                await message.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60 / 24)} days before using this command again.`)], allowedMentions: { parse: [] } });
                return;
            }
            account.lastWeeklyClaim = new Date(now);
            account.weeklyStreak += 1;
            const reward = defaultEconomyConfig.weeklyReward + account.weeklyStreak * 100;
            account.cash += reward;
            account.xp += 150;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'WEEKLY_REWARD', reward, null, account.discordId, { streak: account.weeklyStreak });
            await message.reply({ embeds: [makeEconomyEmbed('🎁 WEEKLY REWARD', `You received ${formatCurrency(reward)}.`, [
                { name: 'Weekly streak', value: `${account.weeklyStreak} weeks`, inline: true },
                { name: 'XP Earned', value: '+150', inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'work': {
            const now = Date.now();
            const next = account.nextWorkAt?.getTime() ?? 0;
            if (now < next) {
                await message.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60)} minutes before your next shift.`)], allowedMentions: { parse: [] } });
                return;
            }
            const job = defaultEconomyConfig.jobs.find(job => job.id === account.jobId) ?? defaultEconomyConfig.jobs[0];
            const pay = job.salary;
            account.cash += pay;
            account.jobXp += job.xp;
            account.xp += job.xp;
            account.lastWorkAt = new Date(now);
            account.nextWorkAt = new Date(now + defaultEconomyConfig.workCooldownSeconds * 1000);
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'WORK_SHIFT', pay, null, account.discordId, { job: account.jobName });
            await message.reply({ embeds: [makeEconomyEmbed('💼 SHIFT COMPLETE', '', [
                { name: 'Job', value: `**${account.jobName}**`, inline: true },
                { name: 'Pay', value: `**${formatCurrency(pay)}**`, inline: true },
                { name: 'XP', value: `+${job.xp} XP`, inline: true },
                { name: 'Next shift', value: `<t:${Math.floor(account.nextWorkAt.getTime() / 1000)}:R>`, inline: false },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'networth': {
            const vehicleValue = account.vehicles.reduce((sum, vehicle) => sum + vehicle.value, 0);
            const propertyValue = account.properties.reduce((sum, property) => sum + property.value, 0);
            await message.reply({ embeds: [makeEconomyEmbed('💎 NET WORTH', '', [
                { name: 'Cash', value: formatCurrency(account.cash), inline: true },
                { name: 'Bank', value: formatCurrency(account.bank), inline: true },
                { name: 'Vehicles', value: formatCurrency(vehicleValue), inline: true },
                { name: 'Properties', value: formatCurrency(propertyValue), inline: true },
                { name: 'Total', value: formatCurrency(account.cash + account.bank + vehicleValue + propertyValue), inline: false },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'bank': {
            await message.reply({ embeds: [makeEconomyEmbed('🏦 LARP NATIONAL BANK', '', [
                { name: 'Cash', value: formatCurrency(account.cash), inline: true },
                { name: 'Bank', value: formatCurrency(account.bank), inline: true },
                { name: 'Total', value: formatCurrency(account.cash + account.bank), inline: true },
                { name: 'Interest', value: `${defaultEconomyConfig.bankInterestRate * 100}%`, inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'deposit': {
            const amount = parseNumber(args[1] ?? '');
            if (!amount || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID AMOUNT\nPlease provide a valid deposit amount.')], allowedMentions: { parse: [] } });
                return;
            }
            account.cash -= amount;
            account.bank += amount;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'DEPOSIT', amount, account.discordId, account.discordId, {});
            await message.reply({ embeds: [makeEconomyEmbed('🏦 DEPOSIT', `Deposited ${formatCurrency(amount)} into your bank.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'withdraw': {
            const amount = parseNumber(args[1] ?? '');
            if (!amount || amount > account.bank) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID AMOUNT\nPlease provide a valid withdrawal amount.')], allowedMentions: { parse: [] } });
                return;
            }
            account.bank -= amount;
            account.cash += amount;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'WITHDRAW', amount, account.discordId, account.discordId, {});
            await message.reply({ embeds: [makeEconomyEmbed('🏦 WITHDRAW', `Withdrew ${formatCurrency(amount)} from your bank.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'transfer': {
            const recipient = parseTargetUser(message, args[1]);
            const amount = parseNumber(args[2] ?? '');
            if (!recipient || !amount || amount > account.bank || recipient.id === message.author.id) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID TRANSFER\nUsage: $transfer @user amount')], allowedMentions: { parse: [] } });
                return;
            }
            const recipientAccount = await getEconomyAccount(message.guild.id, recipient.id);
            account.bank -= amount;
            recipientAccount.bank += amount;
            await account.save();
            await recipientAccount.save();
            await commitTransaction(message.guild.id, account.discordId, 'BANK_TRANSFER_OUT', -amount, account.discordId, recipient.id, {});
            await commitTransaction(message.guild.id, recipient.id, 'BANK_TRANSFER_IN', amount, account.discordId, recipient.id, {});
            await message.reply({ embeds: [makeEconomyEmbed('🏦 BANK TRANSFER', `Transferred ${formatCurrency(amount)} to <@${recipient.id}>.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'transactions': {
            const transactions = await EconomyTransaction.find({ discordId: account.discordId }).sort({ createdAt: -1 }).limit(5).lean().exec();
            const fields = transactions.length ? transactions.map(tx => ({ name: tx.transactionId, value: `${tx.type} • ${formatCurrency(tx.amount)} • Balance After: ${formatCurrency(tx.balanceAfter)}\n<t:${Math.floor(tx.createdAt.getTime() / 1000)}:F>`, inline: false })) : [{ name: 'No transactions', value: 'You have no recent transactions.', inline: false }];
            await message.reply({ embeds: [makeEconomyEmbed('📜 TRANSACTIONS', 'Your recent economy activity.', fields)], allowedMentions: { parse: [] } });
            return;
        }
        case 'jobs': {
            const fields = defaultEconomyConfig.jobs.map(job => ({ name: job.name, value: formatJobLine(job) }));
            await message.reply({ embeds: [makeEconomyEmbed('💼 AVAILABLE JOBS', 'Browse economy job opportunities.', fields)], allowedMentions: { parse: [] } });
            return;
        }
        case 'job': {
            await message.reply({ embeds: [makeEconomyEmbed('💼 CURRENT JOB', '', [
                { name: 'Job', value: account.jobName, inline: true },
                { name: 'Salary', value: formatCurrency(defaultEconomyConfig.jobs.find(job => job.id === account.jobId)?.salary ?? 0), inline: true },
                { name: 'Level', value: `${account.jobLevel}`, inline: true },
                { name: 'XP', value: `${account.jobXp}`, inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'jobapply': {
            const jobId = args[1]?.toLowerCase();
            const job = defaultEconomyConfig.jobs.find(role => role.id === jobId);
            if (!job) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID JOB\nUse $jobs to browse job roles.')], allowedMentions: { parse: [] } });
                return;
            }
            if (account.level < job.requiredLevel) {
                await message.reply({ embeds: [buildEconomyError('❌ LEVEL TOO LOW\nYou do not meet the required level for this job.')], allowedMentions: { parse: [] } });
                return;
            }
            account.jobId = job.id;
            account.jobName = job.name;
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('💼 JOB APPLICATION', `You are now a ${job.name}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'jobquit': {
            account.jobId = 'unemployed';
            account.jobName = 'Unemployed';
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('💼 JOB QUIT', 'You have quit your job.', [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'jobinfo': {
            const jobId = args[1]?.toLowerCase();
            const job = defaultEconomyConfig.jobs.find(role => role.id === jobId);
            if (!job) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID JOB\nUse $jobs to browse job roles.')], allowedMentions: { parse: [] } });
                return;
            }
            await message.reply({ embeds: [makeEconomyEmbed(`💼 JOB INFO — ${job.name}`, job.description, [
                { name: 'Salary', value: formatCurrency(job.salary), inline: true },
                { name: 'Required Level', value: `${job.requiredLevel}`, inline: true },
                { name: 'XP per Shift', value: `${job.xp}`, inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'paycheck': {
            if (!account.pendingPay) {
                await message.reply({ embeds: [buildEconomyError('You have no pending paycheck at this time.')], allowedMentions: { parse: [] } });
                return;
            }
            const amount = account.pendingPay;
            account.cash += amount;
            account.pendingPay = 0;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'PAYCHECK', amount, null, account.discordId, {});
            await message.reply({ embeds: [makeEconomyEmbed('💼 PAYCHECK', `You collected ${formatCurrency(amount)}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'shop': {
            await message.reply({ embeds: [buildEconomyShopEmbed(account)], allowedMentions: { parse: [] } });
            return;
        }
        case 'inventory':
        case 'inv': {
            const items = account.inventory.map(item => `**${item.name}** ×${item.quantity}`).join('\n') || 'No items owned yet.';
            await message.reply({ embeds: [makeEconomyEmbed('🎒 INVENTORY', '', [{ name: 'Items', value: items, inline: false }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'item': {
            const itemName = args.slice(1).join(' ');
            const item = account.inventory.find(item => item.name.toLowerCase() === itemName.toLowerCase());
            if (!item) {
                await message.reply({ embeds: [buildEconomyError('❌ ITEM NOT FOUND\nUse $inventory to view your items.')], allowedMentions: { parse: [] } });
                return;
            }
            await message.reply({ embeds: [makeEconomyEmbed(`📦 ITEM — ${item.name}`, '', [
                { name: 'Quantity', value: `${item.quantity}`, inline: true },
                { name: 'Approx. Value', value: formatCurrency(defaultEconomyConfig.shopItems.find(entry => entry.name === item.name)?.value ?? 0), inline: true },
            ])], allowedMentions: { parse: [] } });
            return;
        }
        case 'use': {
            const itemName = args.slice(1).join(' ');
            const item = account.inventory.find(item => item.name.toLowerCase() === itemName.toLowerCase());
            if (!item || item.quantity <= 0) {
                await message.reply({ embeds: [buildEconomyError('❌ ITEM NOT USABLE\nYou do not have that item to use.')], allowedMentions: { parse: [] } });
                return;
            }
            item.quantity -= 1;
            if (item.quantity === 0) account.inventory = account.inventory.filter(entry => entry.quantity > 0);
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('✅ ITEM USED', `You used one ${item.name}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'gift': {
            const recipient = parseTargetUser(message, args[1]);
            const itemName = args.slice(2).join(' ');
            if (!recipient || !itemName) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID USAGE\nUse $gift @user item')], allowedMentions: { parse: [] } });
                return;
            }
            const item = account.inventory.find(entry => entry.name.toLowerCase() === itemName.toLowerCase());
            if (!item || item.quantity <= 0) {
                await message.reply({ embeds: [buildEconomyError('❌ ITEM NOT FOUND\nYou do not have that item to gift.')], allowedMentions: { parse: [] } });
                return;
            }
            const recipientAccount = await getEconomyAccount(message.guild.id, recipient.id);
            item.quantity -= 1;
            if (item.quantity === 0) account.inventory = account.inventory.filter(entry => entry.quantity > 0);
            const recipientItem = recipientAccount.inventory.find(entry => entry.name.toLowerCase() === item.name.toLowerCase());
            if (recipientItem) recipientItem.quantity += 1;
            else recipientAccount.inventory.push({ itemId: item.itemId, name: item.name, quantity: 1 });
            await account.save();
            await recipientAccount.save();
            await message.reply({ embeds: [makeEconomyEmbed('🎁 ITEM GIFTED', `You gifted ${item.name} to <@${recipient.id}>.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'vehicles':
        case 'cars': {
            const vehicles = account.vehicles.map(vehicle => `**${vehicle.name}** • Condition: ${vehicle.condition}% • Value: ${formatCurrency(vehicle.value)}`).join('\n') || 'No vehicles owned.';
            await message.reply({ embeds: [makeEconomyEmbed('🚗 VEHICLES', '', [{ name: 'Owned Vehicles', value: vehicles, inline: false }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'carsell': {
            const vehicleName = args.slice(1).join(' ');
            const vehicleIndex = account.vehicles.findIndex(vehicle => vehicle.name.toLowerCase() === vehicleName.toLowerCase());
            if (vehicleIndex === -1) {
                await message.reply({ embeds: [buildEconomyError('❌ VEHICLE NOT FOUND\nUse $vehicles to view your owned vehicles.')], allowedMentions: { parse: [] } });
                return;
            }
            const [vehicle] = account.vehicles.splice(vehicleIndex, 1);
            account.cash += vehicle.value;
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('🚗 VEHICLE SOLD', `Sold ${vehicle.name} for ${formatCurrency(vehicle.value)}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'repair':
        case 'vehiclerepair': {
            const vehicleName = args.slice(1).join(' ');
            const vehicle = account.vehicles.find(entry => entry.name.toLowerCase() === vehicleName.toLowerCase());
            if (!vehicle) {
                await message.reply({ embeds: [buildEconomyError('❌ VEHICLE NOT FOUND\nUse $vehicles to view your owned vehicles.')], allowedMentions: { parse: [] } });
                return;
            }
            const cost = Math.max(100, Math.ceil((100 - vehicle.condition) * 10));
            if (account.cash < cost) {
                await message.reply({ embeds: [buildEconomyError('❌ INSUFFICIENT FUNDS\nYou need more cash to repair this vehicle.')], allowedMentions: { parse: [] } });
                return;
            }
            account.cash -= cost;
            vehicle.condition = 100;
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('🔧 VEHICLE REPAIRED', `Repaired ${vehicle.name} for ${formatCurrency(cost)}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'properties':
        case 'props': {
            const properties = account.properties.map(property => `**${property.name}** • Location: ${property.location} • Value: ${formatCurrency(property.value)} • Rent: ${formatCurrency(property.rent)}`).join('\n') || 'No properties owned.';
            await message.reply({ embeds: [makeEconomyEmbed('🏠 PROPERTIES', '', [{ name: 'Owned Properties', value: properties, inline: false }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'propertysell': {
            const propertyName = args.slice(1).join(' ');
            const propertyIndex = account.properties.findIndex(property => property.name.toLowerCase() === propertyName.toLowerCase());
            if (propertyIndex === -1) {
                await message.reply({ embeds: [buildEconomyError('❌ PROPERTY NOT FOUND\nUse $props to view your owned properties.')], allowedMentions: { parse: [] } });
                return;
            }
            const [property] = account.properties.splice(propertyIndex, 1);
            account.cash += property.value;
            await account.save();
            await message.reply({ embeds: [makeEconomyEmbed('🏠 PROPERTY SOLD', `Sold ${property.name} for ${formatCurrency(property.value)}.`, [])], allowedMentions: { parse: [] } });
            return;
        }
        case 'coinflip':
        case 'cf': {
            const amount = parseNumber(args[1] ?? '');
            const choice = args[2]?.toLowerCase();
            if (!amount || !choice || !['heads', 'tails'].includes(choice) || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID COMMAND\nUsage: $coinflip amount heads|tails')], allowedMentions: { parse: [] } });
                return;
            }
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            const win = result === choice;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.coinflipGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'COINFLIP', payout, account.discordId, win ? account.discordId : null, { result, choice });
            await message.reply({ embeds: [makeEconomyEmbed('🪙 COIN FLIP', `Result: **${result.toUpperCase()}**`, [{ name: 'Wager', value: formatCurrency(amount), inline: true }, { name: 'Outcome', value: win ? 'You win!' : 'You lose.', inline: true }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'dice': {
            const amount = parseNumber(args[1] ?? '');
            if (!amount || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nUsage: $dice amount')], allowedMentions: { parse: [] } });
                return;
            }
            const roll1 = getRandomInt(1, 6);
            const roll2 = getRandomInt(1, 6);
            const total = roll1 + roll2;
            const win = total >= 8;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.diceGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'DICE', payout, account.discordId, payout > 0 ? account.discordId : null, { roll1, roll2, total });
            await message.reply({ embeds: [makeEconomyEmbed('🎲 DICE', `Die 1: ${roll1}\nDie 2: ${roll2}\nTotal: ${total}`, [{ name: 'Outcome', value: win ? 'You win!' : 'You lose.', inline: true }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'slots': {
            const amount = parseNumber(args[1] ?? '');
            if (!amount || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nUsage: $slots amount')], allowedMentions: { parse: [] } });
                return;
            }
            const symbols = ['🍒', '🍋', '🍊', '🔔', '⭐', '💎'];
            const result = [symbols[getRandomInt(0, symbols.length - 1)], symbols[getRandomInt(0, symbols.length - 1)], symbols[getRandomInt(0, symbols.length - 1)]];
            const isMatch = result[0] === result[1] && result[1] === result[2];
            const payout = isMatch ? amount * 3 : -amount;
            account.cash += payout;
            account.casinoStats.slotsGames += 1;
            if (payout > 0) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'SLOTS', payout, account.discordId, payout > 0 ? account.discordId : null, { result });
            await message.reply({ embeds: [makeEconomyEmbed('🎰 SLOTS', `${result.join(' | ')}`, [{ name: 'Outcome', value: isMatch ? 'Triple match!' : 'No match', inline: true }, { name: 'Payout', value: formatCurrency(payout), inline: true }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'roulette': {
            const amount = parseNumber(args[1] ?? '');
            const bet = args[2]?.toLowerCase();
            if (!amount || amount > account.cash || !bet || !['red', 'black', 'green'].includes(bet)) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID BET\nUsage: $roulette amount red|black|green')], allowedMentions: { parse: [] } });
                return;
            }
            const spin = getRandomInt(0, 37);
            const color = spin === 0 ? 'green' : spin % 2 === 0 ? 'black' : 'red';
            const win = bet === color;
            const payout = win ? (color === 'green' ? amount * 14 : amount * 2) : -amount;
            account.cash += payout;
            account.casinoStats.rouletteGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'ROULETTE', payout, account.discordId, payout > 0 ? account.discordId : null, { bet, spin, color });
            await message.reply({ embeds: [makeEconomyEmbed('🎡 ROULETTE', `Result: **${spin} — ${color.toUpperCase()}**`, [{ name: 'Bet', value: bet, inline: true }, { name: 'Payout', value: formatCurrency(payout), inline: true }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'highlow': {
            const amount = parseNumber(args[1] ?? '');
            const guess = args[2]?.toLowerCase();
            if (!amount || amount > account.cash || !guess || !['higher', 'lower'].includes(guess)) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID CHOICE\nUsage: $highlow amount higher|lower')], allowedMentions: { parse: [] } });
                return;
            }
            const firstCard = getRandomInt(1, 13);
            const secondCard = getRandomInt(1, 13);
            const win = guess === 'higher' ? secondCard > firstCard : secondCard < firstCard;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.highlowGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'HIGHLOW', payout, account.discordId, payout > 0 ? account.discordId : null, { firstCard, secondCard, guess });
            await message.reply({ embeds: [makeEconomyEmbed('🃏 HIGH / LOW', `First card: ${firstCard}\nSecond card: ${secondCard}`, [{ name: 'Outcome', value: win ? 'You guessed correctly!' : 'You guessed wrong.', inline: true }])], allowedMentions: { parse: [] } });
            return;
        }
        case 'blackjack': {
            const amount = parseNumber(args[1] ?? '');
            if (!amount || amount > account.cash) {
                await message.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nUsage: $blackjack amount')], allowedMentions: { parse: [] } });
                return;
            }
            if (activeGames.has(message.author.id)) {
                await message.reply({ embeds: [buildEconomyError('🎮 GAME ALREADY ACTIVE\nYou already have an active blackjack game.')], allowedMentions: { parse: [] } });
                return;
            }
            const session: EconomyBlackjackSession = {
                userId: message.author.id,
                guildId: message.guild.id,
                playerCards: [drawCard(), drawCard()],
                dealerCards: [drawCard(), drawCard()],
                wager: amount,
                messageId: '',
            };
            activeGames.set(message.author.id, session);
            const reply = await message.reply({ embeds: [renderBlackjackEmbed(session, false)], components: [buildBlackjackButtons(message.author.id)], allowedMentions: { parse: [] } });
            if ('id' in reply) session.messageId = reply.id;
            return;
        }
        default:
            return;
    }
}

export const economyCommands = [
    {
        data: new SlashCommandBuilder().setName('economy').setDescription('Open your LARP economy dashboard'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            await interaction.reply({ embeds: [buildEconomyDashboard(account, interaction.user).embed], components: [actionRowForEconomyLinks, actionRowForEconomyLinksRow2], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('balance').setDescription('Show your economy balance').addUserOption(option => option.setName('user').setDescription('Optional user to view').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const target = interaction.options.getUser('user') ?? interaction.user;
            const account = await getEconomyAccount(interaction.guildId, target.id);
            await interaction.reply({ embeds: [buildBalanceEmbed(account, target)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('profile').setDescription('Show your detailed economy profile').addUserOption(option => option.setName('user').setDescription('Optional user to view').setRequired(false)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const target = interaction.options.getUser('user') ?? interaction.user;
            const account = await getEconomyAccount(interaction.guildId, target.id);
            await interaction.reply({ embeds: [buildProfileEmbed(account, target)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('pay').setDescription('Send fictional currency to another user').addUserOption(option => option.setName('user').setDescription('Recipient user').setRequired(true)).addStringOption(option => option.setName('amount').setDescription('Amount to send').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const recipient = interaction.options.getUser('user');
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            if (!recipient || !amount || recipient.id === interaction.user.id) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID PAYMENT\nPlease select a valid recipient and amount.')], ephemeral: true });
                return;
            }
            const senderAccount = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (amount > senderAccount.cash) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INSUFFICIENT FUNDS\nYou do not have enough cash.')], ephemeral: true });
                return;
            }
            const recipientAccount = await getEconomyAccount(interaction.guildId, recipient.id);
            senderAccount.cash -= amount;
            recipientAccount.cash += amount;
            await senderAccount.save();
            await recipientAccount.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'PAYMENT_OUT', -amount, interaction.user.id, recipient.id, {});
            await commitTransaction(interaction.guildId, recipient.id, 'PAYMENT_IN', amount, interaction.user.id, recipient.id, {});
            await interaction.reply({ embeds: [makeEconomyEmbed('💸 PAYMENT CONFIRMED', `Sent ${formatCurrency(amount)} to <@${recipient.id}>.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('rob').setDescription('Attempt to rob another user').addUserOption(option => option.setName('user').setDescription('Target to rob').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const target = interaction.options.getUser('user');
            if (!target || target.id === interaction.user.id) {
                await interaction.reply({ embeds: [buildEconomyError('❌ Invalid target to rob.')], ephemeral: true });
                return;
            }
            const victim = await getEconomyAccount(interaction.guildId, target.id);
            const robber = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (victim.cash < 100) {
                await interaction.reply({ embeds: [buildEconomyError('❌ Target has too little cash to rob.')], ephemeral: true });
                return;
            }
            const success = Math.random() < 0.4;
            if (success) {
                const stolen = Math.max(50, Math.floor(victim.cash * (0.1 + Math.random() * 0.4)));
                const actualStolen = Math.min(stolen, victim.cash);
                victim.cash -= actualStolen;
                robber.cash += actualStolen;
                await victim.save();
                await robber.save();
                await commitTransaction(interaction.guildId, robber.discordId, 'ROB_SUCCESS', actualStolen, robber.discordId, victim.discordId, { target: victim.discordId });
                await commitTransaction(interaction.guildId, victim.discordId, 'ROBBED', -actualStolen, robber.discordId, victim.discordId, {});
                await interaction.reply({ embeds: [makeEconomyEmbed('🕵️‍♂️ ROBBERY SUCCESS', `You stole ${formatCurrency(actualStolen)} from <@${target.id}>.`, [])], ephemeral: true });
            } else {
                const penalty = Math.min(robber.cash, Math.max(25, Math.floor(robber.cash * (0.05 + Math.random() * 0.15))));
                robber.cash -= penalty;
                victim.cash += penalty;
                await robber.save();
                await victim.save();
                await commitTransaction(interaction.guildId, robber.discordId, 'ROB_FAIL', -penalty, robber.discordId, victim.discordId, {});
                await commitTransaction(interaction.guildId, victim.discordId, 'ROB_DEFENDED', penalty, robber.discordId, victim.discordId, {});
                await interaction.reply({ embeds: [makeEconomyEmbed('💥 ROBBERY FAILED', `You were caught and lost ${formatCurrency(penalty)} to <@${target.id}>.`, [])], ephemeral: true });
            }
        },
    },
    {
        data: new SlashCommandBuilder().setName('daily').setDescription('Claim your 24-hour daily reward'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const now = Date.now();
            const last = account.lastDailyClaim?.getTime() ?? 0;
            const next = last + defaultEconomyConfig.dailyCooldownSeconds * 1000;
            if (now < next) {
                await interaction.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60)} minutes.`)], ephemeral: true });
                return;
            }
            account.lastDailyClaim = new Date(now);
            account.dailyStreak += 1;
            account.cash += defaultEconomyConfig.dailyReward;
            account.xp += 50;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'DAILY_REWARD', defaultEconomyConfig.dailyReward, null, interaction.user.id, { streak: account.dailyStreak });
            await interaction.reply({ embeds: [makeEconomyEmbed('🎁 DAILY REWARD', `You received ${formatCurrency(defaultEconomyConfig.dailyReward)}.`, [
                { name: 'Current streak', value: `${account.dailyStreak} days`, inline: true },
                { name: 'XP earned', value: '+50', inline: true },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const now = Date.now();
            const last = account.lastWeeklyClaim?.getTime() ?? 0;
            const next = last + defaultEconomyConfig.weeklyCooldownSeconds * 1000;
            if (now < next) {
                await interaction.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60 / 24)} days.`)], ephemeral: true });
                return;
            }
            account.lastWeeklyClaim = new Date(now);
            account.weeklyStreak += 1;
            const reward = defaultEconomyConfig.weeklyReward + account.weeklyStreak * 100;
            account.cash += reward;
            account.xp += 150;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'WEEKLY_REWARD', reward, null, interaction.user.id, { streak: account.weeklyStreak });
            await interaction.reply({ embeds: [makeEconomyEmbed('🎁 WEEKLY REWARD', `You received ${formatCurrency(reward)}.`, [
                { name: 'Weekly streak', value: `${account.weeklyStreak} weeks`, inline: true },
                { name: 'XP earned', value: '+150', inline: true },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('work').setDescription('Work your current job'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const now = Date.now();
            const next = account.nextWorkAt?.getTime() ?? 0;
            if (now < next) {
                await interaction.reply({ embeds: [buildEconomyError(`⏱️ COOLDOWN ACTIVE\nYou need to wait ${Math.ceil((next - now) / 1000 / 60)} minutes.`)], ephemeral: true });
                return;
            }
            const job = defaultEconomyConfig.jobs.find(job => job.id === account.jobId) ?? defaultEconomyConfig.jobs[0];
            const pay = job.salary;
            account.cash += pay;
            account.jobXp += job.xp;
            account.xp += job.xp;
            account.lastWorkAt = new Date(now);
            account.nextWorkAt = new Date(now + defaultEconomyConfig.workCooldownSeconds * 1000);
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'WORK_SHIFT', pay, null, interaction.user.id, { job: account.jobName });
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 SHIFT COMPLETE', '', [
                { name: 'Job', value: `**${account.jobName}**`, inline: true },
                { name: 'Pay', value: `**${formatCurrency(pay)}**`, inline: true },
                { name: 'XP', value: `+${job.xp} XP`, inline: true },
                { name: 'Next shift', value: `<t:${Math.floor(account.nextWorkAt.getTime() / 1000)}:R>`, inline: false },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('networth').setDescription('View your net worth'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const vehicleValue = account.vehicles.reduce((sum, vehicle) => sum + vehicle.value, 0);
            const propertyValue = account.properties.reduce((sum, property) => sum + property.value, 0);
            await interaction.reply({ embeds: [makeEconomyEmbed('💎 NET WORTH', '', [
                { name: 'Cash', value: formatCurrency(account.cash), inline: true },
                { name: 'Bank', value: formatCurrency(account.bank), inline: true },
                { name: 'Vehicles', value: formatCurrency(vehicleValue), inline: true },
                { name: 'Properties', value: formatCurrency(propertyValue), inline: true },
                { name: 'Total Net Worth', value: formatCurrency(account.cash + account.bank + vehicleValue + propertyValue), inline: false },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('bank').setDescription('View bank details'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            await interaction.reply({ embeds: [makeEconomyEmbed('🏦 LARP NATIONAL BANK', '', [
                { name: 'Cash', value: formatCurrency(account.cash), inline: true },
                { name: 'Bank', value: formatCurrency(account.bank), inline: true },
                { name: 'Total', value: formatCurrency(account.cash + account.bank), inline: true },
                { name: 'Interest', value: `${defaultEconomyConfig.bankInterestRate * 100}%`, inline: true },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('deposit').setDescription('Deposit cash into your bank').addStringOption(option => option.setName('amount').setDescription('Amount to deposit').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID AMOUNT\nPlease enter an amount you can deposit.')], ephemeral: true });
                return;
            }
            account.cash -= amount;
            account.bank += amount;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'DEPOSIT', amount, interaction.user.id, interaction.user.id, {});
            await interaction.reply({ embeds: [makeEconomyEmbed('🏦 DEPOSIT', `Deposited ${formatCurrency(amount)}.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw money from your bank').addStringOption(option => option.setName('amount').setDescription('Amount to withdraw').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.bank) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID AMOUNT\nPlease enter an amount you can withdraw.')], ephemeral: true });
                return;
            }
            account.bank -= amount;
            account.cash += amount;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'WITHDRAW', amount, interaction.user.id, interaction.user.id, {});
            await interaction.reply({ embeds: [makeEconomyEmbed('🏦 WITHDRAW', `Withdrew ${formatCurrency(amount)}.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('transfer').setDescription('Transfer bank funds to another user').addUserOption(option => option.setName('user').setDescription('Recipient').setRequired(true)).addStringOption(option => option.setName('amount').setDescription('Amount to transfer').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const recipient = interaction.options.getUser('user');
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!recipient || !amount || amount > account.bank || recipient.id === interaction.user.id) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID TRANSFER\nPlease select a valid recipient and amount.')], ephemeral: true });
                return;
            }
            const recipientAccount = await getEconomyAccount(interaction.guildId, recipient.id);
            account.bank -= amount;
            recipientAccount.bank += amount;
            await account.save();
            await recipientAccount.save();
            await commitTransaction(interaction.guildId, account.discordId, 'BANK_TRANSFER_OUT', -amount, account.discordId, recipient.id, {});
            await commitTransaction(interaction.guildId, recipient.id, 'BANK_TRANSFER_IN', amount, account.discordId, recipient.id, {});
            await interaction.reply({ embeds: [makeEconomyEmbed('🏦 BANK TRANSFER', `Transferred ${formatCurrency(amount)} to <@${recipient.id}>.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('transactions').setDescription('Show your recent economy transactions'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const transactions = await EconomyTransaction.find({ discordId: account.discordId }).sort({ createdAt: -1 }).limit(5).lean().exec();
            const fields = transactions.length ? transactions.map(tx => ({ name: tx.transactionId, value: `${tx.type} • ${formatCurrency(tx.amount)} • Balance After: ${formatCurrency(tx.balanceAfter)}\n<t:${Math.floor(tx.createdAt.getTime() / 1000)}:F>`, inline: false })) : [{ name: 'No transactions', value: 'You have no recent transactions.', inline: false }];
            await interaction.reply({ embeds: [makeEconomyEmbed('📜 TRANSACTIONS', 'Your recent economy activity.', fields)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('jobs').setDescription('Show available jobs'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const fields = defaultEconomyConfig.jobs.map(job => ({ name: job.name, value: formatJobLine(job) }));
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 AVAILABLE JOBS', 'Browse job opportunities in the city.', fields)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('job').setDescription('View your current job'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 CURRENT JOB', '', [
                { name: 'Job', value: account.jobName, inline: true },
                { name: 'Salary', value: formatCurrency(defaultEconomyConfig.jobs.find(job => job.id === account.jobId)?.salary ?? 0), inline: true },
                { name: 'Level', value: `${account.jobLevel}`, inline: true },
                { name: 'XP', value: `${account.jobXp}`, inline: true },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('job-apply').setDescription('Apply for a job').addStringOption(option => option.setName('job').setDescription('Job ID to apply for').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const jobId = interaction.options.getString('job')?.toLowerCase();
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const job = defaultEconomyConfig.jobs.find(job => job.id === jobId);
            if (!job) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID JOB\nUse /jobs to browse roles.')], ephemeral: true });
                return;
            }
            if (account.level < job.requiredLevel) {
                await interaction.reply({ embeds: [buildEconomyError('❌ LEVEL TOO LOW\nYou do not meet the required level for this role.')], ephemeral: true });
                return;
            }
            account.jobId = job.id;
            account.jobName = job.name;
            await account.save();
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 JOB APPLICATION', `You are now a ${job.name}.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('job-quit').setDescription('Quit your current job'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            account.jobId = 'unemployed';
            account.jobName = 'Unemployed';
            await account.save();
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 JOB QUIT', 'You have quit your job.', [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('job-info').setDescription('View job information').addStringOption(option => option.setName('job').setDescription('Job ID to view').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const jobId = interaction.options.getString('job')?.toLowerCase();
            const job = defaultEconomyConfig.jobs.find(job => job.id === jobId);
            if (!job) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID JOB\nUse /jobs to browse roles.')], ephemeral: true });
                return;
            }
            await interaction.reply({ embeds: [makeEconomyEmbed(`💼 JOB INFO — ${job.name}`, job.description, [
                { name: 'Salary', value: formatCurrency(job.salary), inline: true },
                { name: 'Required Level', value: `${job.requiredLevel}`, inline: true },
                { name: 'XP per Shift', value: `${job.xp}`, inline: true },
            ])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('paycheck').setDescription('Collect your pending paycheck'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!account.pendingPay) {
                await interaction.reply({ embeds: [buildEconomyError('You have no pending paycheck at this time.')], ephemeral: true });
                return;
            }
            const expect = account.pendingPay;
            account.cash += expect;
            account.pendingPay = 0;
            await account.save();
            await commitTransaction(account.guildId, account.discordId, 'PAYCHECK', expect, null, account.discordId, {});
            await interaction.reply({ embeds: [makeEconomyEmbed('💼 PAYCHECK', `You collected ${formatCurrency(expect)}.`, [])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('shop').setDescription('Open the interactive shop'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            await interaction.reply({ embeds: [buildEconomyShopEmbed(account)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('inventory').setDescription('Show your inventory'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const items = account.inventory.map(item => `**${item.name}** ×${item.quantity}`).join('\n') || 'No items owned.';
            await interaction.reply({ embeds: [makeEconomyEmbed('🎒 INVENTORY', '', [{ name: 'Items', value: items, inline: false }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('vehicles').setDescription('Show all owned vehicles'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const vehicles = account.vehicles.map(vehicle => `**${vehicle.name}** • Condition: ${vehicle.condition}% • Value: ${formatCurrency(vehicle.value)}`).join('\n') || 'No vehicles owned.';
            await interaction.reply({ embeds: [makeEconomyEmbed('🚗 VEHICLES', '', [{ name: 'Owned Vehicles', value: vehicles, inline: false }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('properties').setDescription('Show all owned properties'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const properties = account.properties.map(property => `**${property.name}** • Location: ${property.location} • Value: ${formatCurrency(property.value)}`).join('\n') || 'No properties owned.';
            await interaction.reply({ embeds: [makeEconomyEmbed('🏠 PROPERTIES', '', [{ name: 'Owned Properties', value: properties, inline: false }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('casino').setDescription('Open the casino interface'),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            if (!CASINO_ENABLED) {
                await interaction.reply({ embeds: [buildEconomyError('The casino is currently disabled.')], ephemeral: true });
                return;
            }
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            const fields: APIEmbedField[] = [
                { name: 'Available Balance', value: formatCurrency(account.cash), inline: true },
                { name: 'Blackjack Games', value: `${account.casinoStats.blackjackGames}`, inline: true },
                { name: 'Slots Played', value: `${account.casinoStats.slotsGames}`, inline: true },
            ];
            await interaction.reply({ embeds: [makeEconomyEmbed('🎰 LARP GRAND CASINO', 'Choose a casino game to play.', fields)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nEnter a valid amount within your cash balance.')], ephemeral: true });
                return;
            }
            if (activeGames.has(interaction.user.id)) {
                await interaction.reply({ embeds: [buildEconomyError('🎮 GAME ALREADY ACTIVE\nYou already have an active blackjack game.')], ephemeral: true });
                return;
            }
            const session: EconomyBlackjackSession = {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                playerCards: [drawCard(), drawCard()],
                dealerCards: [drawCard(), drawCard()],
                wager: amount,
                messageId: '',
            };
            activeGames.set(interaction.user.id, session);
            await interaction.reply({ embeds: [renderBlackjackEmbed(session, false)], components: [buildBlackjackButtons(interaction.user.id)], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('slots').setDescription('Play slots').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nEnter a valid amount within your cash balance.')], ephemeral: true });
                return;
            }
            const symbols = ['🍒', '🍋', '🍊', '🔔', '⭐', '💎'];
            const result = [symbols[getRandomInt(0, symbols.length - 1)], symbols[getRandomInt(0, symbols.length - 1)], symbols[getRandomInt(0, symbols.length - 1)]];
            const isMatch = result[0] === result[1] && result[1] === result[2];
            const payout = isMatch ? amount * 3 : -amount;
            account.cash += payout;
            account.casinoStats.slotsGames += 1;
            if (payout > 0) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'SLOTS', payout, interaction.user.id, payout > 0 ? interaction.user.id : null, { result });
            await interaction.reply({ embeds: [makeEconomyEmbed('🎰 SLOTS', `${result.join(' | ')}`, [{ name: 'Outcome', value: isMatch ? 'Triple match!' : 'No match', inline: true }, { name: 'Payout', value: formatCurrency(payout), inline: true }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('roulette').setDescription('Play roulette').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)).addStringOption(option => option.setName('bet').setDescription('red, black or green').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const bet = interaction.options.getString('bet')?.toLowerCase();
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash || !bet || !['red', 'black', 'green'].includes(bet)) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID BET\nUse /roulette amount red|black|green.')], ephemeral: true });
                return;
            }
            const spin = getRandomInt(0, 37);
            const color = spin === 0 ? 'green' : spin % 2 === 0 ? 'black' : 'red';
            const win = bet === color;
            const payout = win ? (color === 'green' ? amount * 14 : amount * 2) : -amount;
            account.cash += payout;
            account.casinoStats.rouletteGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'ROULETTE', payout, interaction.user.id, payout > 0 ? interaction.user.id : null, { bet, spin, color });
            await interaction.reply({ embeds: [makeEconomyEmbed('🎡 ROULETTE', `Result: **${spin} — ${color.toUpperCase()}**`, [{ name: 'Bet', value: bet, inline: true }, { name: 'Payout', value: formatCurrency(payout), inline: true }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('dice').setDescription('Roll dice in the casino').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID WAGER\nEnter a valid amount within your cash balance.')], ephemeral: true });
                return;
            }
            const roll1 = getRandomInt(1, 6);
            const roll2 = getRandomInt(1, 6);
            const total = roll1 + roll2;
            const win = total >= 8;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.diceGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'DICE', payout, interaction.user.id, payout > 0 ? interaction.user.id : null, { roll1, roll2, total });
            await interaction.reply({ embeds: [makeEconomyEmbed('🎲 DICE', `Die 1: ${roll1}\nDie 2: ${roll2}\nTotal: ${total}`, [{ name: 'Outcome', value: win ? 'You win!' : 'You lose.', inline: true }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin in the casino').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)).addStringOption(option => option.setName('choice').setDescription('heads or tails').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const choice = interaction.options.getString('choice')?.toLowerCase();
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash || !choice || !['heads', 'tails'].includes(choice)) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID CHOICE\nUse /coinflip amount heads|tails.')], ephemeral: true });
                return;
            }
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            const win = result === choice;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.coinflipGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'COINFLIP', payout, interaction.user.id, payout > 0 ? interaction.user.id : null, { choice, result });
            await interaction.reply({ embeds: [makeEconomyEmbed('🪙 COIN FLIP', `Result: **${result.toUpperCase()}**`, [{ name: 'Wager', value: formatCurrency(amount), inline: true }, { name: 'Payout', value: formatCurrency(payout), inline: true }])], ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder().setName('highlow').setDescription('Play High / Low').addStringOption(option => option.setName('amount').setDescription('Amount to wager').setRequired(true)).addStringOption(option => option.setName('guess').setDescription('higher or lower').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            if (!interaction.guildId) {
                await interaction.reply({ embeds: [buildEconomyError('This command must be used in a server.')], ephemeral: true });
                return;
            }
            const amount = parseNumber(interaction.options.getString('amount') ?? '');
            const guess = interaction.options.getString('guess')?.toLowerCase();
            const account = await getEconomyAccount(interaction.guildId, interaction.user.id);
            if (!amount || amount > account.cash || !guess || !['higher', 'lower'].includes(guess)) {
                await interaction.reply({ embeds: [buildEconomyError('❌ INVALID CHOICE\nUse /highlow amount higher|lower.')], ephemeral: true });
                return;
            }
            const firstCard = getRandomInt(1, 13);
            const secondCard = getRandomInt(1, 13);
            const win = guess === 'higher' ? secondCard > firstCard : secondCard < firstCard;
            const payout = win ? amount : -amount;
            account.cash += payout;
            account.casinoStats.highlowGames += 1;
            if (win) account.casinoStats.totalWins += 1;
            else account.casinoStats.totalLosses += 1;
            await account.save();
            await commitTransaction(interaction.guildId, interaction.user.id, 'HIGHLOW', payout, interaction.user.id, payout > 0 ? interaction.user.id : null, { firstCard, secondCard, guess });
            await interaction.reply({ embeds: [makeEconomyEmbed('🃏 HIGH / LOW', `First card: ${firstCard}\nSecond card: ${secondCard}`, [{ name: 'Outcome', value: win ? 'You guessed correctly!' : 'You guessed wrong.', inline: true }])], ephemeral: true });
        },
    },
];

export async function handleEconomyMessage(message: Message): Promise<void> {
    if (message.author.bot || !message.guild) return;
    // caret-admin commands (e.g. ^ @user 500) — admin grants money
    if (message.content.trim().startsWith('^')) {
        const parts = message.content.trim().slice(1).trim().split(/\s+/);
        const targetArg = parts[0];
        const amountArg = parts[1];
        const member = message.member;
        if (!hasEconomyAdminRole(member)) {
            await message.reply({ embeds: [buildEconomyError('❌ Permission denied — admin role required.')], allowedMentions: { parse: [] } });
            return;
        }
        const target = parseTargetUser(message, targetArg);
        const amount = parseNumber(amountArg ?? '');
        if (!target || !amount) {
            await message.reply({ embeds: [buildEconomyError('❌ Invalid usage. Format: ^ @user amount')], allowedMentions: { parse: [] } });
            return;
        }
        const targetAccount = await getEconomyAccount(message.guild.id, target.id);
        targetAccount.cash += amount;
        await targetAccount.save();
        await commitTransaction(message.guild.id, target.id, 'ADMIN_GRANT', amount, member?.id ?? null, target.id, { grantedBy: member?.id ?? null });
        await message.reply({ embeds: [makeEconomyEmbed('✅ ADMIN GRANT', `Gave ${formatCurrency(amount)} to <@${target.id}>.`, [])], allowedMentions: { parse: [] } });
        return;
    }

    await handlePrefixEconomyCommand(message);
}

export async function handleEconomyButton(interaction: ButtonInteraction): Promise<boolean> {
    return handleEconomyButtons(interaction);
}

export async function handleEconomySelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    return handleEconomySelection(interaction);
}

export async function handleEconomyModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    return handleEconomyModals(interaction);
}
