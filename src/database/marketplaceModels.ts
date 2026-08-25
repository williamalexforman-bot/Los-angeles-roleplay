import { Model, Schema, model, models } from 'mongoose';

export type MarketplaceClaimStatus = 'available' | 'consumed';

export interface MarketplaceClaimRecord {
    claimId: string;
    guildId: string;
    discordUserId: string;
    robloxUserId: string;
    robloxUsername?: string;
    productKey: string;
    itemId: string;
    status: MarketplaceClaimStatus;
    ticketChannelId?: string;
    consumedByAdId?: string;
    claimedAt: Date;
    consumedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const marketplaceClaimSchema = new Schema<MarketplaceClaimRecord>({
    claimId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    discordUserId: { type: String, required: true, index: true },
    robloxUserId: { type: String, required: true, index: true },
    robloxUsername: String,
    productKey: { type: String, required: true, index: true },
    itemId: { type: String, required: true },
    status: { type: String, enum: ['available', 'consumed'], default: 'available', index: true },
    ticketChannelId: String,
    consumedByAdId: String,
    claimedAt: { type: Date, required: true, default: Date.now },
    consumedAt: Date,
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
});

// A game pass is a one-time purchase. Enforce uniqueness by both linked
// Discord account and Roblox account so relinking cannot claim it twice.
marketplaceClaimSchema.index(
    { guildId: 1, discordUserId: 1, productKey: 1 },
    { unique: true },
);
marketplaceClaimSchema.index(
    { guildId: 1, robloxUserId: 1, productKey: 1 },
    { unique: true },
);

export type PaidAdStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface PaidAdRecord {
    adId: string;
    guildId: string;
    ownerDiscordId: string;
    robloxUserId: string;
    ticketChannelId: string;
    baseClaimId: string;
    productKey: string;
    productLabel: string;
    pingType: 'everyone' | 'here';
    sponsored: boolean;
    serverName: string;
    inviteLink: string;
    advertisement: string;
    status: PaidAdStatus;
    priority: boolean;
    instant: boolean;
    scheduledFor: Date;
    processingStartedAt?: Date;
    publishedAt?: Date;
    publishedChannelId?: string;
    publishedMessageId?: string;
    failureReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const paidAdSchema = new Schema<PaidAdRecord>({
    adId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    ownerDiscordId: { type: String, required: true, index: true },
    robloxUserId: { type: String, required: true, index: true },
    ticketChannelId: { type: String, required: true, index: true },
    baseClaimId: { type: String, required: true, unique: true },
    productKey: { type: String, required: true },
    productLabel: { type: String, required: true },
    pingType: { type: String, enum: ['everyone', 'here'], required: true },
    sponsored: { type: Boolean, required: true, default: false },
    serverName: { type: String, required: true, maxlength: 100 },
    inviteLink: { type: String, required: true, maxlength: 500 },
    advertisement: { type: String, required: true, maxlength: 4_000 },
    status: {
        type: String,
        enum: ['scheduled', 'publishing', 'published', 'failed', 'cancelled'],
        default: 'scheduled',
        index: true,
    },
    priority: { type: Boolean, required: true, default: false },
    instant: { type: Boolean, required: true, default: false },
    scheduledFor: { type: Date, required: true, index: true },
    processingStartedAt: Date,
    publishedAt: Date,
    publishedChannelId: String,
    publishedMessageId: String,
    failureReason: String,
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
});

paidAdSchema.index({ status: 1, scheduledFor: 1 });

export const MarketplaceClaim = (
    models.MarketplaceClaim as Model<MarketplaceClaimRecord> | undefined
) ?? model<MarketplaceClaimRecord>('MarketplaceClaim', marketplaceClaimSchema);

export const PaidAd = (
    models.PaidAd as Model<PaidAdRecord> | undefined
) ?? model<PaidAdRecord>('PaidAd', paidAdSchema);
