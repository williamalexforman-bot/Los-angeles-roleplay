import { Model, Schema, model, models } from 'mongoose';

export type SuggestionStatus = 'Pending' | 'Maybe' | 'Approved' | 'Denied';

export interface SuggestionRecord {
    suggestionId: string;
    guildId: string;
    userId: string;
    discordUsername: string;
    content: string;
    status: SuggestionStatus;
    upvotes: string[];
    downvotes: string[];
    channelId: string;
    messageId: string;
    createdAt: Date;
    updatedAt: Date;
    decidedAt?: Date;
    decidedById?: string;
}

const suggestionSchema = new Schema<SuggestionRecord>({
    suggestionId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    discordUsername: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Maybe', 'Approved', 'Denied'], default: 'Pending', index: true },
    upvotes: { type: [String], default: [] },
    downvotes: { type: [String], default: [] },
    channelId: { type: String, required: true },
    messageId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    decidedAt: Date,
    decidedById: String,
});

export const Suggestion = (
    models.Suggestion as Model<SuggestionRecord> | undefined
) ?? model<SuggestionRecord>('Suggestion', suggestionSchema);
