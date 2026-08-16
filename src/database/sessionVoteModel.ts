import { Model, Schema, model, models } from 'mongoose';

export interface SessionVoteVoterRecord {
    userId: string;
    username: string;
    votedAt: Date;
}

export interface SessionVoteRecord {
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    requiredVotes: number;
    voters: SessionVoteVoterRecord[];
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const sessionVoteSchema = new Schema<SessionVoteRecord>({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, unique: true },
    startedById: { type: String, required: true },
    requiredVotes: { type: Number, required: true, min: 1, max: 50 },
    voters: {
        type: [{
            userId: { type: String, required: true },
            username: { type: String, required: true },
            votedAt: { type: Date, default: Date.now },
        }],
        default: [],
    },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

sessionVoteSchema.index({ guildId: 1, channelId: 1, createdAt: -1 });

export const SessionVoteState = (
    models.SessionVoteState as Model<SessionVoteRecord> | undefined
) ?? model<SessionVoteRecord>('SessionVoteState', sessionVoteSchema);
