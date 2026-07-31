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

export interface TicketRecord {
    guildId: string;
    number: number;
    channelId: string;
    creatorId: string;
    category: 'general' | 'internal' | 'management' | 'highrank';
    supportRoleId: string;
    status: 'pending' | 'open' | 'closed';
    openingMessageId?: string;
    controlsMessageId?: string;
    claimedBy?: string | null;
    aiEnabled: boolean;
    escalated: boolean;
    addedUserIds: string[];
    answers: Record<string, string>;
    discordInfo?: Record<string, unknown>;
    robloxInfo?: Record<string, unknown>;
    closeReason?: string;
    createdAt: Date;
    closedAt?: Date;
}

const ticketSchema = new Schema<TicketRecord>({
    guildId: { type: String, required: true, index: true },
    number: { type: Number, required: true },
    channelId: { type: String, required: true, unique: true },
    creatorId: { type: String, required: true, index: true },
    category: { type: String, required: true, enum: ['general', 'internal', 'management', 'highrank'] },
    supportRoleId: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'open', 'closed'], default: 'pending' },
    openingMessageId: String,
    controlsMessageId: String,
    claimedBy: { type: String, default: null },
    aiEnabled: { type: Boolean, default: true },
    escalated: { type: Boolean, default: false },
    addedUserIds: { type: [String], default: [] },
    answers: { type: Schema.Types.Mixed, default: {} },
    discordInfo: { type: Schema.Types.Mixed },
    robloxInfo: { type: Schema.Types.Mixed },
    closeReason: String,
    createdAt: { type: Date, default: Date.now },
    closedAt: Date,
});

ticketSchema.index({ guildId: 1, number: 1 }, { unique: true });
ticketSchema.index(
    { guildId: 1, creatorId: 1, category: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ['pending', 'open'] } } },
);

const counterSchema = new Schema({
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
});

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
const Ticket = model<TicketRecord>('Ticket', ticketSchema);
const Counter = model('Counter', counterSchema);
const Infraction = model<InfractionRecord>('Infraction', infractionSchema);
const ErlcState = model('ErlcState', erlcStateSchema);
const ProhibitedWord = model('ProhibitedWord', prohibitedWordSchema);
const AuditEvent = model('AuditEvent', auditEventSchema);
const ActivityCheck = model<ActivityCheckRecord>('ActivityCheck', activityCheckSchema);

export { User, Log, Ticket, Counter, Infraction, ErlcState, ProhibitedWord, AuditEvent, ActivityCheck };
