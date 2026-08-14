import { Counter, Infraction } from './models';
import { isDatabaseAvailable } from './connection';
import {
    configureInfractionPersistence,
    type InfractionRecord as CommandInfractionRecord,
} from '../commands/staffManagement';

function requireDatabase(): void {
    if (!isDatabaseAvailable()) throw new Error('MongoDB is unavailable.');
}

function numericCaseNumber(caseNumber: string): number {
    return Number(caseNumber.replace(/\D/g, '')) || 0;
}

function fromDatabase(record: Record<string, unknown>): CommandInfractionRecord {
    const history = Array.isArray(record.history) ? record.history : [];
    return {
        caseNumber: String(record.caseNumber),
        guildId: String(record.guildId),
        memberId: String(record.memberId),
        memberUsername: String(record.memberUsername),
        issuedById: String(record.issuedById),
        action: String(record.action) as CommandInfractionRecord['action'],
        reason: String(record.reason),
        ruleBroken: String(record.ruleBroken),
        evidence: String(record.evidence),
        internalNotes: String(record.internalNotes),
        notifyMember: Boolean(record.notifyMember),
        appealable: record.appealable === undefined ? true : Boolean(record.appealable),
        expiration: String(record.expiration),
        status: String(record.status) as CommandInfractionRecord['status'],
        parentChannelId: String(record.parentChannelId),
        headerMessageId: String(record.headerMessageId),
        threadId: String(record.threadId),
        detailMessageId: String(record.detailMessageId),
        createdAt: new Date(String(record.createdAt)).toISOString(),
        updatedAt: new Date(String(record.updatedAt)).toISOString(),
        history: history.map(value => {
            const entry = value as Record<string, unknown>;
            return {
                action: String(entry.action),
                actorId: String(entry.actorId),
                details: String(entry.details),
                timestamp: new Date(String(entry.timestamp)).toISOString(),
            };
        }),
    };
}

export function configureInfractionDatabaseAdapter(): void {
    configureInfractionPersistence({
        async nextCaseNumber(guildId) {
            requireDatabase();
            const counter = await Counter.findOneAndUpdate(
                { key: `infraction:${guildId}` },
                { $inc: { value: 1 } },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).lean().exec();
            return Number(counter?.value || 1);
        },
        async saveInfraction(record) {
            requireDatabase();
            await Infraction.findOneAndUpdate(
                { threadId: record.threadId },
                {
                    $set: {
                        ...record,
                        number: numericCaseNumber(record.caseNumber),
                        createdAt: new Date(record.createdAt),
                        updatedAt: new Date(record.updatedAt),
                        history: record.history.map(entry => ({ ...entry, timestamp: new Date(entry.timestamp) })),
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).exec();
        },
        async getInfractionByThreadId(threadId) {
            requireDatabase();
            const record = await Infraction.findOne({
                $or: [{ threadId }, { caseNumber: threadId }],
            }).lean().exec();
            return record ? fromDatabase(record as unknown as Record<string, unknown>) : null;
        },
    });
}
