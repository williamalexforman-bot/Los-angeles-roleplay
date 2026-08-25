import { Model, Schema, model, models } from 'mongoose';

export type GiveawayStatus = 'active' | 'ending' | 'ended';

export interface GiveawayRecord {
    guildId: string;
    channelId: string;
    messageId: string;
    hostId: string;
    prize: string;
    winnerCount: number;
    endsAt: Date;
    entrantIds: string[];
    winnerIds: string[];
    status: GiveawayStatus;
    processingStartedAt?: Date;
    resultMessageId?: string;
    endedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const giveawaySchema = new Schema<GiveawayRecord>({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, unique: true },
    hostId: { type: String, required: true },
    prize: { type: String, required: true, maxlength: 1_000 },
    winnerCount: { type: Number, required: true, min: 1, max: 20 },
    endsAt: { type: Date, required: true, index: true },
    entrantIds: { type: [String], default: [] },
    winnerIds: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'ending', 'ended'], default: 'active', index: true },
    processingStartedAt: Date,
    resultMessageId: String,
    endedAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

giveawaySchema.index({ status: 1, endsAt: 1 });

export const GiveawayState = (
    models.GiveawayState as Model<GiveawayRecord> | undefined
) ?? model<GiveawayRecord>('GiveawayState', giveawaySchema);
