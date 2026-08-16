import { ApplicationSession as ApplicationSessionModel } from './models';
import { isDatabaseAvailable } from './connection';
import {
    configureApplicationSessionPersistence,
    type ApplicationSession,
} from '../commands/applications';

function requireDatabase(): void {
    if (!isDatabaseAvailable()) throw new Error('MongoDB is unavailable.');
}

export function configureApplicationSessionDatabaseAdapter(): void {
    configureApplicationSessionPersistence({
        async loadApplicationSession(userId) {
            requireDatabase();
            const record = await ApplicationSessionModel.findOne({ userId }).lean().exec();
            if (!record) return null;
            return {
                type: record.type,
                guildId: record.guildId,
                answers: Array.isArray(record.answers) ? record.answers.map(String) : [],
                nextQuestion: Number(record.nextQuestion),
                startedAt: new Date(record.startedAt).getTime(),
                lastActivityAt: new Date(record.lastActivityAt).getTime(),
                promptPending: Boolean(record.promptPending),
            } satisfies ApplicationSession;
        },
        async saveApplicationSession(userId, session) {
            requireDatabase();
            await ApplicationSessionModel.findOneAndUpdate(
                { userId },
                {
                    $set: {
                        type: session.type,
                        guildId: session.guildId,
                        answers: session.answers,
                        nextQuestion: session.nextQuestion,
                        startedAt: new Date(session.startedAt),
                        lastActivityAt: new Date(session.lastActivityAt),
                        promptPending: session.promptPending,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).exec();
        },
        async deleteApplicationSession(userId) {
            requireDatabase();
            await ApplicationSessionModel.deleteOne({ userId }).exec();
        },
    });
}
