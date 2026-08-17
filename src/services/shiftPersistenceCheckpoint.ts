import type { Client } from 'discord.js';
import { connectDatabase, isDatabaseAvailable } from '../database/connection';
import { ShiftProfile } from '../database/models';
import { shiftQuotaWeekKey } from '../commands/shift';
import { logger } from '../utils/logger';

const CHECKPOINT_INTERVAL_MS = 60_000;
const MIN_CHECKPOINT_SECONDS = 5;
const DATABASE_RECONNECT_COOLDOWN_MS = 60_000;
const MAX_REASONABLE_ACTIVE_GAP_MS = 24 * 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let checkpointRunning = false;
let lastReconnectAttemptAt = 0;

function accumulateByWeek(startedAt: Date, endedAt: Date): Record<string, number> {
    const increments: Record<string, number> = {};
    let cursor = startedAt.getTime();
    const end = endedAt.getTime();

    // Walk in one-minute slices so the Friday 10 AM Eastern reset is split
    // correctly even across DST without duplicating the quota-boundary code.
    while (cursor < end) {
        const next = Math.min(end, cursor + 60_000);
        const key = shiftQuotaWeekKey(new Date(cursor));
        increments[key] = (increments[key] || 0) + ((next - cursor) / 1000);
        cursor = next;
    }
    return increments;
}

async function ensureDatabase(): Promise<boolean> {
    if (isDatabaseAvailable()) return true;
    const now = Date.now();
    if (now - lastReconnectAttemptAt < DATABASE_RECONNECT_COOLDOWN_MS) return false;
    lastReconnectAttemptAt = now;
    return connectDatabase().catch(() => false);
}

export async function checkpointActiveShifts(client: Client, at: Date = new Date()): Promise<void> {
    if (checkpointRunning) return;
    checkpointRunning = true;
    try {
        if (!(await ensureDatabase())) {
            logger.warn('[Shift Save] MongoDB is unavailable; active shift checkpoint postponed.');
            return;
        }

        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;

        const active = await ShiftProfile.find({
            guildId,
            activeStartedAt: { $exists: true, $ne: null },
        }).lean().exec();

        let saved = 0;
        for (const raw of active) {
            const startedAt = raw.activeStartedAt ? new Date(raw.activeStartedAt) : null;
            if (!startedAt || !Number.isFinite(startedAt.getTime())) continue;

            const elapsedMs = at.getTime() - startedAt.getTime();
            if (elapsedMs < MIN_CHECKPOINT_SECONDS * 1000) continue;

            // A stale active timer older than a day should not silently manufacture
            // unlimited quota time. Leave it for the normal role/timer recovery flow.
            if (elapsedMs > MAX_REASONABLE_ACTIVE_GAP_MS) {
                logger.warn(`[Shift Save] Skipped stale active timer for ${raw.userId}; it is older than 24 hours.`);
                continue;
            }

            const increments = accumulateByWeek(startedAt, at);
            const update: Record<string, number | Date> = {
                activeStartedAt: at,
                updatedAt: at,
            };
            const inc: Record<string, number> = {};
            for (const [weekKey, seconds] of Object.entries(increments)) {
                if (seconds > 0) inc[`weeklySeconds.${weekKey}`] = seconds;
            }
            if (!Object.keys(inc).length) continue;

            // Filter on the exact old timestamp. If /shift break or /shift end raced
            // this checkpoint, that command changes/unsets activeStartedAt first and
            // this update safely becomes a no-op instead of double-crediting time.
            const result = await ShiftProfile.updateOne(
                {
                    guildId,
                    userId: raw.userId,
                    activeStartedAt: startedAt,
                },
                {
                    $inc: inc,
                    $set: update,
                },
            ).exec();
            if (result.modifiedCount === 1) saved += 1;
        }

        if (saved > 0) logger.info(`[Shift Save] Persisted ${saved} active shift checkpoint${saved === 1 ? '' : 's'}.`);
    } catch (error) {
        logger.warn(`[Shift Save] Active shift checkpoint failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        checkpointRunning = false;
    }
}

export function startShiftPersistenceCheckpointScheduler(client: Client): void {
    stopShiftPersistenceCheckpointScheduler();
    void checkpointActiveShifts(client);
    timer = setInterval(() => void checkpointActiveShifts(client), CHECKPOINT_INTERVAL_MS);
    logger.info('[Shift Save] Durable active-shift checkpointing enabled every 60 seconds.');
}

export function stopShiftPersistenceCheckpointScheduler(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
