import { Model, Schema, model, models } from 'mongoose';

export interface BotSecretRecord {
    name: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    updatedAt: Date;
}

const botSecretSchema = new Schema<BotSecretRecord>({
    name: { type: String, required: true, unique: true, index: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },
});

export const BotSecret = (
    models.BotSecret as Model<BotSecretRecord> | undefined
) ?? model<BotSecretRecord>('BotSecret', botSecretSchema);
