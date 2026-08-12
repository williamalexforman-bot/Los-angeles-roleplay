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

// Economy models removed

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

export interface BanAppealRecord {
    appealId: string;
    guildId: string;
    userId: string;
    username: string;
    robloxUsername: string;
    discordUsername: string;
    banReason: string;
    unbanReason: string;
    falseBanDetails: string;
    status: 'Pending' | 'Approved' | 'Denied';
    reviewMessageId: string;
    reviewChannelId: string;
    reviewedById?: string;
    reviewReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const banAppealSchema = new Schema<BanAppealRecord>({
    appealId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    robloxUsername: { type: String, required: true },
    discordUsername: { type: String, required: true },
    banReason: { type: String, required: true },
    unbanReason: { type: String, required: true },
    falseBanDetails: { type: String, default: 'Not provided.' },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
    reviewMessageId: { type: String, default: '' },
    reviewChannelId: { type: String, default: '' },
    reviewedById: String,
    reviewReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

export interface InfractionAppealRecord {
    appealId: string;
    guildId: string;
    infractionThreadId: string;
    infractionCaseNumber: string;
    infractionLink: string;
    userId: string;
    username: string;
    discordUsername: string;
    robloxUsername: string;
    appealReason: string;
    willRepeat: string;
    status: 'Pending' | 'Approved' | 'Denied';
    reviewMessageId: string;
    reviewChannelId: string;
    reviewedById?: string;
    reviewReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const infractionAppealSchema = new Schema<InfractionAppealRecord>({
    appealId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true, index: true },
    infractionThreadId: { type: String, required: true, index: true },
    infractionCaseNumber: { type: String, required: true },
    infractionLink: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    discordUsername: { type: String, required: true },
    robloxUsername: { type: String, required: true },
    appealReason: { type: String, required: true },
    willRepeat: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
    reviewMessageId: { type: String, default: '' },
    reviewChannelId: { type: String, default: '' },
    reviewedById: String,
    reviewReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

const User = model('User', userSchema);
const Log = model('Log', logSchema);
const Counter = model('Counter', counterSchema);
const Infraction = model<InfractionRecord>('Infraction', infractionSchema);
const ErlcState = model('ErlcState', erlcStateSchema);
const ProhibitedWord = model('ProhibitedWord', prohibitedWordSchema);
const AuditEvent = model('AuditEvent', auditEventSchema);
const ActivityCheck = model<ActivityCheckRecord>('ActivityCheck', activityCheckSchema);
const BanAppeal = model<BanAppealRecord>('BanAppeal', banAppealSchema);
const InfractionAppeal = model<InfractionAppealRecord>('InfractionAppeal', infractionAppealSchema);

export { User, Log, Counter, Infraction, ErlcState, ProhibitedWord, AuditEvent, ActivityCheck, BanAppeal, InfractionAppeal };
