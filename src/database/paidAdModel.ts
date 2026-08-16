import { Model, Schema, model, models } from 'mongoose';

export type PaidAdPingType = 'everyone' | 'here';
export type PaidAdStatus = 'Setup' | 'Scheduled' | 'Posting' | 'Posted' | 'Cancelled';

export interface PaidAdRecord {
    adId: string;
    guildId: string;
    userId: string;
    discordUsername: string;
    robloxUserId: string;
    robloxUsername: string;
    productKey: 'paid-ad-everyone' | 'paid-ad-here';
    productItemType: string;
    productItemId: string;
    pingType: PaidAdPingType;
    threadId: string;
    setupMessageId: string;
    serverName?: string;
    serverInvite?: string;
    advertisement?: string;
    status: PaidAdStatus;
    scheduleSlot?: string;
    scheduledAt?: Date;
    postedAt?: Date;
    postedMessageId?: string;
    instantPostedById?: string;
    claimedAt: Date;
    updatedAt: Date;
}

const paidAdSchema = new Schema<PaidAdRecord>({
    adId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    discordUsername: { type: String, required: true },
    robloxUserId: { type: String, required: true, index: true },
    robloxUsername: { type: String, required: true },
    productKey: { type: String, enum: ['paid-ad-everyone', 'paid-ad-here'], required: true },
    productItemType: { type: String, required: true },
    productItemId: { type: String, required: true },
    pingType: { type: String, enum: ['everyone', 'here'], required: true },
    threadId: { type: String, default: '' },
    setupMessageId: { type: String, default: '' },
    serverName: String,
    serverInvite: String,
    advertisement: String,
    status: { type: String, enum: ['Setup', 'Scheduled', 'Posting', 'Posted', 'Cancelled'], default: 'Setup', index: true },
    scheduleSlot: { type: String, index: true },
    scheduledAt: { type: Date, index: true },
    postedAt: Date,
    postedMessageId: String,
    instantPostedById: String,
    claimedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// An inventory-owned item can only create one paid-ad claim for one Roblox user.
// This prevents a persistent pass/asset from being claimed over and over.
paidAdSchema.index({ guildId: 1, robloxUserId: 1, productItemId: 1 }, { unique: true });
// One global scheduled advertisement is allowed per weekly slot.
paidAdSchema.index({ guildId: 1, scheduleSlot: 1 }, { unique: true, sparse: true });

export const PaidAd = (
    models.PaidAd as Model<PaidAdRecord> | undefined
) ?? model<PaidAdRecord>('PaidAd', paidAdSchema);
