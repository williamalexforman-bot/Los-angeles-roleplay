import { Model, Schema, model, models } from 'mongoose';

export type EmergencyDispatchStatus = 'Active' | 'Ended';

export interface EmergencyDispatchNote {
    authorId: string;
    text: string;
    createdAt: Date;
}

export interface EmergencyDispatchClosestUnit {
    robloxId?: string;
    robloxUsername: string;
    callsign?: string;
    team: string;
    postalCode?: string;
    streetName?: string;
    distance: number;
}

export interface EmergencyDispatchCallRecord {
    dispatchId: string;
    guildId: string;
    callNumber: number;
    startedAt: number;
    team: string;
    callerRobloxId: string;
    callerRobloxUsername: string;
    description: string;
    positionDescriptor: string;
    positionX: number;
    positionZ: number;
    closestUnits: EmergencyDispatchClosestUnit[];
    assignedDiscordIds: string[];
    notes: EmergencyDispatchNote[];
    status: EmergencyDispatchStatus;
    channelId: string;
    messageId: string;
    createdAt: Date;
    updatedAt: Date;
    endedAt?: Date;
    endedById?: string;
}

const closestUnitSchema = new Schema<EmergencyDispatchClosestUnit>({
    robloxId: String,
    robloxUsername: { type: String, required: true },
    callsign: String,
    team: { type: String, required: true },
    postalCode: String,
    streetName: String,
    distance: { type: Number, required: true },
}, { _id: false });

const noteSchema = new Schema<EmergencyDispatchNote>({
    authorId: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });

const emergencyDispatchCallSchema = new Schema<EmergencyDispatchCallRecord>({
    dispatchId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    callNumber: { type: Number, required: true },
    startedAt: { type: Number, required: true, index: true },
    team: { type: String, required: true },
    callerRobloxId: { type: String, required: true, index: true },
    callerRobloxUsername: { type: String, required: true },
    description: { type: String, default: 'No details provided.' },
    positionDescriptor: { type: String, default: 'Location unavailable.' },
    positionX: { type: Number, required: true },
    positionZ: { type: Number, required: true },
    closestUnits: { type: [closestUnitSchema], default: [] },
    assignedDiscordIds: { type: [String], default: [] },
    notes: { type: [noteSchema], default: [] },
    status: { type: String, enum: ['Active', 'Ended'], default: 'Active', index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    endedAt: Date,
    endedById: String,
});

emergencyDispatchCallSchema.index(
    { guildId: 1, callNumber: 1, startedAt: 1 },
    { unique: true },
);

export const EmergencyDispatchCall = (
    models.EmergencyDispatchCall as Model<EmergencyDispatchCallRecord> | undefined
) ?? model<EmergencyDispatchCallRecord>('EmergencyDispatchCall', emergencyDispatchCallSchema);
