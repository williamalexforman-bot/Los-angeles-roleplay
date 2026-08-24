import { ApplicationSession as ApplicationSessionModel } from './models';
import { isDatabaseAvailable } from './connection';
import {
    configureApplicationSessionPersistence,
    type ApplicationSession,
} from '../commands/applications';

const APPLICATION_DB_INTERACTION_TIMEOUT_MS = 850;

function requireDatabase(): void {
    if (!isDatabaseAvailable()) throw new Error('MongoDB is unavailable.');
}

async function withinInteractionBudget<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            operation,
            new Promise<T>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Application database request exceeded the Discord interaction budget.')),
                    APPLICATION_DB_INTERACTION_TIMEOUT_MS,
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function configureApplicationSessionDatabaseAdapter(): void {
    configureApplicationSessionPersistence({
        async loadApplicationSession(userId) {
            requireDatabase();
            const record = await withinInteractionBudget(
                ApplicationSessionModel.findOne({ userId }).lean().exec(),
            );
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
            await withinInteractionBudget(ApplicationSessionModel.deleteOne({ userId }).exec());
        },
    });
}