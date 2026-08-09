import { Schema, model } from 'mongoose';

const userSchema = new Schema({
    discordId: { type: String, required: true, unique: true },
    robloxUsername: { type: String, required: true },
    robloxUserId: { type: String, required: true },
    verified: { type: Boolean, default: false },
    joinDate: { type: Date, default: Date.now },
});

const logSchema = new Schema({
    caseNumber: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    staffMember: { type: String, required: true },
    action: { type: String, required: true },
    reason: { type: String },
    proof: { type: String },
    timestamp: { type: Date, default: Date.now },
    result: { type: String },
});

const counterSchema = new Schema({
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
});

export interface EconomyInventoryItem {
    itemId: string;
    name: string;
    quantity: number;
}

export interface EconomyVehicleRecord {
    vehicleId: string;
    name: string;
    value: number;
    condition: number;
    level: number;
    insured: boolean;
    purchasedAt: Date;
}

export interface EconomyPropertyRecord {
    propertyId: string;
    name: string;
    value: number;
    location: string;
    upgraded: number;
    rent: number;
    purchasedAt: Date;
}

export interface EconomyCasinoStats {
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

export interface EconomyAccountRecord {
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
}

const economyAccountSchema = new Schema<EconomyAccountRecord>({
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    cash: { type: Number, required: true, default: 0 },
    bank: { type: Number, required: true, default: 0 },
    xp: { type: Number, required: true, default: 0 },
    level: { type: Number, required: true, default: 1 },
    jobId: { type: String, required: true, default: 'unemployed' },
    jobName: { type: String, required: true, default: 'Unemployed' },
    jobLevel: { type: Number, required: true, default: 0 },
    jobXp: { type: Number, required: true, default: 0 },
    dailyStreak: { type: Number, required: true, default: 0 },
    weeklyStreak: { type: Number, required: true, default: 0 },
    lastDailyClaim: { type: Date, default: null },
    lastWeeklyClaim: { type: Date, default: null },
    lastWorkAt: { type: Date, default: null },
    nextWorkAt: { type: Date, default: null },
    pendingPay: { type: Number, required: true, default: 0 },
    achievements: { type: [String], default: [] },
    inventory: { type: [{ itemId: String, name: String, quantity: Number }], default: [] },
    vehicles: { type: [{ vehicleId: String, name: String, value: Number, condition: Number, level: Number, insured: Boolean, purchasedAt: Date }], default: [] },
    properties: { type: [{ propertyId: String, name: String, value: Number, location: String, upgraded: Number, rent: Number, purchasedAt: Date }], default: [] },
    casinoStats: {
        type: {
            blackjackGames: { type: Number, default: 0 },
            blackjackWins: { type: Number, default: 0 },
            slotsGames: { type: Number, default: 0 },
            rouletteGames: { type: Number, default: 0 },
            diceGames: { type: Number, default: 0 },
            coinflipGames: { type: Number, default: 0 },
            pokerGames: { type: Number, default: 0 },
            highlowGames: { type: Number, default: 0 },
            totalWins: { type: Number, default: 0 },
            totalLosses: { type: Number, default: 0 },
        },
        default: {},
    },
    economyBan: { type: Boolean, required: true, default: false },
    lastInterestAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

economyAccountSchema.index({ guildId: 1, discordId: 1 }, { unique: true });

export interface EconomyTransactionRecord {
    guildId: string;
    discordId: string;
    transactionId: string;
    type: string;
    amount: number;
    senderId: string | null;
    recipientId: string | null;
    balanceAfter: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
}

const economyTransactionSchema = new Schema<EconomyTransactionRecord>({
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    senderId: { type: String, default: null },
    recipientId: { type: String, default: null },
    balanceAfter: { type: Number, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
});

economyTransactionSchema.index({ discordId: 1, createdAt: -1 });

type MarketplaceStatus = 'ACTIVE' | 'SOLD' | 'CANCELED';

export interface EconomyListingRecord {
    guildId: string;
    listingId: string;
    sellerId: string;
    itemId: string;
    itemName: string;
    price: number;
    quantity: number;
    status: MarketplaceStatus;
    createdAt: Date;
}

const economyListingSchema = new Schema<EconomyListingRecord>({
    guildId: { type: String, required: true, index: true },
    listingId: { type: String, required: true, unique: true },
    sellerId: { type: String, required: true, index: true },
    itemId: { type: String, required: true },
    itemName: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 1 },
    status: { type: String, required: true, enum: ['ACTIVE', 'SOLD', 'CANCELED'], default: 'ACTIVE' },
    createdAt: { type: Date, default: Date.now },
});

economyListingSchema.index({ guildId: 1, status: 1, createdAt: -1 });

export interface InfractionRecord {
    caseNumber: string;
    guildId: string;
    number: number;
    threadId: string;
    parentChannelId: string;
    headerMessageId: string;
    detailMessageId: string;
    memberId: string;
    memberUsername: string;
    issuedById: string;
    action: string;
    reason: string;
    ruleBroken: string;
    evidence: string;
    internalNotes: string;
    notifyMember: boolean;
    expiration: string;
    status: 'Active' | 'Voided' | 'Closed';
    history: Array<{ action: string; actorId: string; details: string; timestamp: Date }>;
    createdAt: Date;
    updatedAt: Date;
}

const infractionSchema = new Schema<InfractionRecord>({
    caseNumber: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    number: { type: Number, required: true },
    threadId: { type: String, required: true, unique: true },
    parentChannelId: { type: String, required: true },
    headerMessageId: { type: String, required: true },
    detailMessageId: { type: String, required: true },
    memberId: { type: String, required: true, index: true },
    memberUsername: { type: String, required: true },
    issuedById: { type: String, required: true },
    action: { type: String, required: true },
    reason: { type: String, required: true },
    ruleBroken: { type: String, required: true },
    evidence: { type: String, default: 'No evidence supplied.' },
    internalNotes: { type: String, default: 'No internal notes supplied.' },
    notifyMember: { type: Boolean, default: false },
    expiration: { type: String, default: 'No expiration set.' },
    status: { type: String, enum: ['Active', 'Voided', 'Closed'], default: 'Active' },
    history: {
        type: [{
            action: { type: String, required: true },
            actorId: { type: String, required: true },
            details: { type: String, required: true },
            timestamp: { type: Date, required: true },
        }],
        default: [],
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

infractionSchema.index({ guildId: 1, number: 1 }, { unique: true });

const erlcStateSchema = new Schema({
    guildId: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
    initialized: { type: Boolean, default: false },
    seenCommandIds: { type: [String], default: [] },
    teams: { type: Schema.Types.Mixed, default: {} },
    outbox: { type: [Schema.Types.Mixed], default: [] },
    updatedAt: { type: Date, default: Date.now },
});

const prohibitedWordSchema = new Schema({
    guildId: { type: String, required: true },
    word: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: String,
    createdAt: { type: Date, default: Date.now },
});
prohibitedWordSchema.index({ guildId: 1, word: 1 }, { unique: true });

const auditEventSchema = new Schema({
    guildId: String,
    kind: { type: String, required: true, index: true },
    actorId: String,
    targetId: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
});

export interface ActivityCheckRecord {
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    startedAt: Date;
    endsAt?: Date;
    active: boolean;
    voters: Array<{ userId: string; username: string; votedAt: Date }>;
}

const activityCheckSchema = new Schema<ActivityCheckRecord>({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    startedById: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    endsAt: Date,
    active: { type: Boolean, default: true },
    voters: { type: [{ userId: String, username: String, votedAt: { type: Date, default: Date.now } }], default: [] },
});

const User = model('User', userSchema);
const Log = model('Log', logSchema);
const Counter = model('Counter', counterSchema);
const Infraction = model<InfractionRecord>('Infraction', infractionSchema);
const EconomyAccount = model<EconomyAccountRecord>('EconomyAccount', economyAccountSchema);
const EconomyTransaction = model<EconomyTransactionRecord>('EconomyTransaction', economyTransactionSchema);
const EconomyListing = model<EconomyListingRecord>('EconomyListing', economyListingSchema);
const ErlcState = model('ErlcState', erlcStateSchema);
const ProhibitedWord = model('ProhibitedWord', prohibitedWordSchema);
const AuditEvent = model('AuditEvent', auditEventSchema);
const ActivityCheck = model<ActivityCheckRecord>('ActivityCheck', activityCheckSchema);

export { User, Log, Counter, Infraction, EconomyAccount, EconomyTransaction, EconomyListing, ErlcState, ProhibitedWord, AuditEvent, ActivityCheck };
