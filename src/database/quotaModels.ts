import { Model, Schema, model, models } from 'mongoose';

export type QuotaDecision = 'Accepted' | 'Rejected';
export type QuotaRejectReason = 'Spam' | 'Profanity' | 'TOS' | 'Raid' | 'LowQuality' | 'Command';
export type QuotaWeekStatus = 'Active' | 'Finalizing' | 'Ended';
export type QuotaAppealStatus = 'Pending' | 'Approved' | 'Denied';
export type QuotaFailureAppealStatus = 'Active' | 'Pending' | 'Approved' | 'Denied';

export interface QuotaRecentAccepted {
    hash: string;
    at: Date;
}

export interface QuotaRejectCounts {
    spam: number;
    profanity: number;
    tos: number;
    raid: number;
    lowQuality: number;
    command: number;
}

export interface MessageQuotaProfileRecord {
    guildId: string;
    userId: string;
    username: string;
    weekKey: string;
    count: number;
    required: number;
    roleId: string;
    roleName: string;
    completionNotifiedRequirement: number;
    completionLoggedRequirement: number;
    recentAccepted: QuotaRecentAccepted[];
    rejected: QuotaRejectCounts;
    createdAt: Date;
    updatedAt: Date;
}

const recentAcceptedSchema = new Schema<QuotaRecentAccepted>({
    hash: { type: String, required: true },
    at: { type: Date, required: true },
}, { _id: false });

const quotaProfileSchema = new Schema<MessageQuotaProfileRecord>({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    weekKey: { type: String, required: true, index: true },
    count: { type: Number, default: 0, min: 0 },
    required: { type: Number, required: true, min: 1 },
    roleId: { type: String, required: true },
    roleName: { type: String, required: true },
    completionNotifiedRequirement: { type: Number, default: 0, min: 0 },
    completionLoggedRequirement: { type: Number, default: 0, min: 0 },
    recentAccepted: { type: [recentAcceptedSchema], default: [] },
    rejected: {
        spam: { type: Number, default: 0, min: 0 },
        profanity: { type: Number, default: 0, min: 0 },
        tos: { type: Number, default: 0, min: 0 },
        raid: { type: Number, default: 0, min: 0 },
        lowQuality: { type: Number, default: 0, min: 0 },
        command: { type: Number, default: 0, min: 0 },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});
quotaProfileSchema.index({ guildId: 1, userId: 1, weekKey: 1 }, { unique: true });

export interface QuotaFailedMemberRecord {
    userId: string;
    username: string;
    roleId: string;
    roleName: string;
    count: number;
    required: number;
    appealStatus: QuotaFailureAppealStatus;
    appealId?: string;
}

const quotaFailedMemberSchema = new Schema<QuotaFailedMemberRecord>({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    roleId: { type: String, required: true },
    roleName: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
    required: { type: Number, required: true, min: 1 },
    appealStatus: {
        type: String,
        enum: ['Active', 'Pending', 'Approved', 'Denied'],
        default: 'Active',
    },
    appealId: String,
}, { _id: false });

export interface MessageQuotaWeekRecord {
    guildId: string;
    weekKey: string;
    startedAt: Date;
    deadlineAt: Date;
    originalDeadlineAt: Date;
    status: QuotaWeekStatus;
    extensionCount: number;
    extendedById?: string;
    extensionReason?: string;
    finalizationLeaseUntil?: Date;
    endedAt?: Date;
    endedById?: string;
    endedReason?: string;
    nextStartAt?: Date;
    finalMessageId?: string;
    finalChannelId?: string;
    failedMembers: QuotaFailedMemberRecord[];
    exemptMissedUserIds: string[];
    createdAt: Date;
    updatedAt: Date;
}

const quotaWeekSchema = new Schema<MessageQuotaWeekRecord>({
    guildId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true, index: true },
    originalDeadlineAt: { type: Date, required: true },
    status: { type: String, enum: ['Active', 'Finalizing', 'Ended'], default: 'Active', index: true },
    extensionCount: { type: Number, default: 0, min: 0 },
    extendedById: String,
    extensionReason: String,
    finalizationLeaseUntil: Date,
    endedAt: Date,
    endedById: String,
    endedReason: String,
    nextStartAt: Date,
    finalMessageId: String,
    finalChannelId: String,
    failedMembers: { type: [quotaFailedMemberSchema], default: [] },
    exemptMissedUserIds: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});
quotaWeekSchema.index({ guildId: 1, weekKey: 1 }, { unique: true });

export interface QuotaMessageEventRecord {
    messageId: string;
    guildId: string;
    channelId: string;
    userId: string;
    weekKey: string;
    decision: QuotaDecision;
    rejectReason?: QuotaRejectReason;
    contentHash: string;
    createdAt: Date;
}

const quotaMessageEventSchema = new Schema<QuotaMessageEventRecord>({
    messageId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    decision: { type: String, enum: ['Accepted', 'Rejected'], required: true },
    rejectReason: { type: String, enum: ['Spam', 'Profanity', 'TOS', 'Raid', 'LowQuality', 'Command'] },
    contentHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 21 * 24 * 60 * 60 },
});

export interface QuotaAppealRecord {
    appealId: string;
    guildId: string;
    weekKey: string;
    userId: string;
    username: string;
    reason: string;
    status: QuotaAppealStatus;
    reviewMessageId: string;
    reviewChannelId: string;
    reviewedById?: string;
    reviewReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const quotaAppealSchema = new Schema<QuotaAppealRecord>({
    appealId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending', index: true },
    reviewMessageId: { type: String, default: '' },
    reviewChannelId: { type: String, default: '' },
    reviewedById: String,
    reviewReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});
quotaAppealSchema.index({ guildId: 1, weekKey: 1, userId: 1 }, { unique: true });

export const MessageQuotaProfile = (
    models.MessageQuotaProfile as Model<MessageQuotaProfileRecord> | undefined
) ?? model<MessageQuotaProfileRecord>('MessageQuotaProfile', quotaProfileSchema);

export const MessageQuotaWeek = (
    models.MessageQuotaWeek as Model<MessageQuotaWeekRecord> | undefined
) ?? model<MessageQuotaWeekRecord>('MessageQuotaWeek', quotaWeekSchema);

export const QuotaMessageEvent = (
    models.QuotaMessageEvent as Model<QuotaMessageEventRecord> | undefined
) ?? model<QuotaMessageEventRecord>('QuotaMessageEvent', quotaMessageEventSchema);

export const QuotaAppeal = (
    models.QuotaAppeal as Model<QuotaAppealRecord> | undefined
) ?? model<QuotaAppealRecord>('QuotaAppeal', quotaAppealSchema);
