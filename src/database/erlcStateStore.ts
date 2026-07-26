import { ErlcState } from './models';
import { isDatabaseAvailable } from './connection';
import { MemoryErlcMonitorStateStore, type ErlcMonitorState, type ErlcMonitorStateStore } from '../monitors/erlcMonitor';

export class MongoErlcMonitorStateStore implements ErlcMonitorStateStore {
    private readonly memory = new MemoryErlcMonitorStateStore();

    constructor(private readonly guildId: string) {}

    async load(): Promise<ErlcMonitorState | null> {
        if (!isDatabaseAvailable()) return this.memory.load();
        const record = await ErlcState.findOne({ guildId: this.guildId }).lean().exec();
        if (!record) return null;
        return {
            version: 1,
            initialized: record.initialized === true,
            seenCommandIds: Array.isArray(record.seenCommandIds) ? record.seenCommandIds.map(String) : [],
            teams: (record.teams && typeof record.teams === 'object' ? record.teams : {}) as ErlcMonitorState['teams'],
            outbox: (Array.isArray(record.outbox) ? record.outbox : []) as unknown as ErlcMonitorState['outbox'],
            updatedAt: record.updatedAt ? new Date(record.updatedAt).getTime() : Date.now(),
        };
    }

    async save(state: ErlcMonitorState): Promise<void> {
        await this.memory.save(state);
        if (!isDatabaseAvailable()) return;
        await ErlcState.findOneAndUpdate(
            { guildId: this.guildId },
            {
                $set: {
                    version: 1,
                    initialized: state.initialized,
                    seenCommandIds: state.seenCommandIds,
                    teams: state.teams,
                    outbox: state.outbox,
                    updatedAt: new Date(state.updatedAt),
                },
            },
            { upsert: true, new: true },
        ).exec();
    }
}
