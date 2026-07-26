import { randomUUID } from 'crypto';
import { Counter, Ticket, type TicketRecord } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { logger } from '../utils/logger';

const memoryTickets = new Map<string, TicketRecord>();
const memoryCounters = new Map<string, number>();
type TicketBackend = 'mongo' | 'memory';

const backendByChannelId = new Map<string, TicketBackend>();
const deferredMongoPendingDeletes = new Set<string>();
const deferredMongoRecordDeletes = new Set<string>();
const DEFAULT_PENDING_RESERVATION_TTL_MS = 15 * 60 * 1000;
const MIN_PENDING_RESERVATION_TTL_MS = 60 * 1000;
const MAX_PENDING_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const AUTOMATIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastAutomaticCleanupAt = 0;
let automaticCleanup: Promise<void> | null = null;

export interface TicketReservationInput {
    guildId: string;
    creatorId: string;
    category: TicketRecord['category'];
    supportRoleId: string;
    answers: Record<string, string>;
    discordInfo: Record<string, unknown>;
    robloxInfo: Record<string, unknown>;
}

export interface TicketReservationResult {
    ticket?: TicketRecord;
    duplicate?: TicketRecord;
}

export interface TicketReservationCleanupOptions {
    maxAgeMs?: number;
    now?: number;
}

function cloneTicket(ticket: TicketRecord): TicketRecord {
    return {
        ...ticket,
        answers: { ...ticket.answers },
        discordInfo: ticket.discordInfo ? { ...ticket.discordInfo } : undefined,
        robloxInfo: ticket.robloxInfo ? { ...ticket.robloxInfo } : undefined,
        addedUserIds: [...ticket.addedUserIds],
    };
}

function findMemoryDuplicate(input: Pick<TicketReservationInput, 'guildId' | 'creatorId' | 'category'>) {
    return [...memoryTickets.values()].find(ticket =>
        ticket.guildId === input.guildId
        && ticket.creatorId === input.creatorId
        && ticket.category === input.category
        && (ticket.status === 'pending' || ticket.status === 'open'),
    );
}

function pendingBackend(channelId: string): TicketBackend | null {
    if (channelId.startsWith('pending:mongo:')) return 'mongo';
    if (channelId.startsWith('pending:memory:')) return 'memory';
    return backendByChannelId.get(channelId) ?? (memoryTickets.has(channelId) ? 'memory' : null);
}

function boundedPendingTtl(value: number | undefined): number {
    const configured = value ?? Number(process.env.TICKET_PENDING_TTL_MS || DEFAULT_PENDING_RESERVATION_TTL_MS);
    if (!Number.isFinite(configured)) return DEFAULT_PENDING_RESERVATION_TTL_MS;
    return Math.max(MIN_PENDING_RESERVATION_TTL_MS, Math.min(MAX_PENDING_RESERVATION_TTL_MS, Math.floor(configured)));
}

async function flushDeferredMongoDeletes(): Promise<void> {
    if (!isDatabaseAvailable()) return;

    for (const pendingChannelId of [...deferredMongoPendingDeletes]) {
        const result = await Ticket.deleteOne({ channelId: pendingChannelId, status: 'pending' }).exec();
        if (result.acknowledged) {
            deferredMongoPendingDeletes.delete(pendingChannelId);
            backendByChannelId.delete(pendingChannelId);
        }
    }

    for (const channelId of [...deferredMongoRecordDeletes]) {
        const result = await Ticket.deleteOne({ channelId }).exec();
        if (result.acknowledged) {
            deferredMongoRecordDeletes.delete(channelId);
            backendByChannelId.delete(channelId);
        }
    }
}

async function flushDeferredMongoDeletesSafely(): Promise<void> {
    if (deferredMongoPendingDeletes.size === 0 && deferredMongoRecordDeletes.size === 0) return;
    try {
        await flushDeferredMongoDeletes();
    } catch (error) {
        logger.warn(`Deferred ticket rollback cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Removes abandoned reservations only. Open and closed tickets are excluded by
 * the status predicate even if their creation timestamp is old.
 */
export async function cleanupStaleTicketReservations(
    options: TicketReservationCleanupOptions = {},
): Promise<number> {
    const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
    const cutoff = new Date(now - boundedPendingTtl(options.maxAgeMs));
    let removed = 0;

    for (const [channelId, ticket] of memoryTickets) {
        if (ticket.status !== 'pending' || ticket.createdAt.getTime() >= cutoff.getTime()) continue;
        memoryTickets.delete(channelId);
        backendByChannelId.delete(channelId);
        removed += 1;
    }

    if (isDatabaseAvailable()) {
        await flushDeferredMongoDeletes();
        const staleIds = await Ticket.find(
            { status: 'pending', createdAt: { $lt: cutoff } },
            { channelId: 1 },
        ).lean<Array<{ channelId: string }>>().exec();
        const result = await Ticket.deleteMany({ status: 'pending', createdAt: { $lt: cutoff } }).exec();
        removed += result.deletedCount || 0;
        for (const stale of staleIds) backendByChannelId.delete(stale.channelId);
    }

    return removed;
}

async function runAutomaticCleanup(): Promise<void> {
    const now = Date.now();
    if (automaticCleanup) return automaticCleanup;
    if (now - lastAutomaticCleanupAt < AUTOMATIC_CLEANUP_INTERVAL_MS) {
        if (isDatabaseAvailable()) await flushDeferredMongoDeletesSafely();
        return;
    }

    lastAutomaticCleanupAt = now;
    automaticCleanup = cleanupStaleTicketReservations()
        .then(() => undefined)
        .catch(error => logger.warn(`Stale ticket-reservation cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`))
        .finally(() => {
            automaticCleanup = null;
        });
    return automaticCleanup;
}

export async function reserveTicket(input: TicketReservationInput): Promise<TicketReservationResult> {
    await runAutomaticCleanup();

    const memoryDuplicate = findMemoryDuplicate(input);
    if (memoryDuplicate) return { duplicate: cloneTicket(memoryDuplicate) };

    const backend: TicketBackend = isDatabaseAvailable() ? 'mongo' : 'memory';
    if (backend === 'mongo') {
        const duplicate = await Ticket.findOne({
            guildId: input.guildId,
            creatorId: input.creatorId,
            category: input.category,
            status: { $in: ['pending', 'open'] },
        }).lean<TicketRecord>().exec();
        if (duplicate) return { duplicate };

        const localNumberFloor = memoryCounters.get(input.guildId) || 0;
        if (localNumberFloor > 0) {
            await Counter.findOneAndUpdate(
                { key: `ticket:${input.guildId}` },
                { $max: { value: localNumberFloor } },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).exec();
        }
        const counter = await Counter.findOneAndUpdate(
            { key: `ticket:${input.guildId}` },
            { $inc: { value: 1 } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean().exec();

        const number = Number(counter?.value || 1);
        memoryCounters.set(input.guildId, Math.max(memoryCounters.get(input.guildId) || 0, number));
        const pendingChannelId = `pending:mongo:${randomUUID()}`;
        try {
            const created = await Ticket.create({
                ...input,
                number,
                channelId: pendingChannelId,
                status: 'pending',
                claimedBy: null,
                aiEnabled: true,
                escalated: false,
                addedUserIds: [],
                createdAt: new Date(),
            });
            const ticket = created.toObject() as TicketRecord;
            backendByChannelId.set(ticket.channelId, 'mongo');
            return { ticket };
        } catch (error) {
            if ((error as { code?: number }).code === 11000) {
                const raceWinner = await Ticket.findOne({
                    guildId: input.guildId,
                    creatorId: input.creatorId,
                    category: input.category,
                    status: { $in: ['pending', 'open'] },
                }).lean<TicketRecord>().exec();
                if (raceWinner) return { duplicate: raceWinner };
            }
            throw error;
        }
    }

    const number = (memoryCounters.get(input.guildId) || 0) + 1;
    memoryCounters.set(input.guildId, number);
    const ticket: TicketRecord = {
        ...input,
        number,
        channelId: `pending:memory:${randomUUID()}`,
        status: 'pending',
        claimedBy: null,
        aiEnabled: true,
        escalated: false,
        addedUserIds: [],
        createdAt: new Date(),
    };
    memoryTickets.set(ticket.channelId, ticket);
    backendByChannelId.set(ticket.channelId, 'memory');
    return { ticket: cloneTicket(ticket) };
}

export async function activateTicket(pendingChannelId: string, channelId: string): Promise<TicketRecord | null> {
    const backend = pendingBackend(pendingChannelId);
    if (backend === 'mongo') {
        if (!isDatabaseAvailable()) return null;
        await flushDeferredMongoDeletesSafely();
        const activated = await Ticket.findOneAndUpdate(
            { channelId: pendingChannelId },
            { $set: { channelId, status: 'open' } },
            { new: true },
        ).lean<TicketRecord>().exec();
        if (activated) {
            backendByChannelId.delete(pendingChannelId);
            backendByChannelId.set(channelId, 'mongo');
        }
        return activated;
    }

    if (backend !== 'memory') return null;
    const existing = memoryTickets.get(pendingChannelId);
    if (!existing) return null;
    memoryTickets.delete(pendingChannelId);
    existing.channelId = channelId;
    existing.status = 'open';
    memoryTickets.set(channelId, existing);
    backendByChannelId.delete(pendingChannelId);
    backendByChannelId.set(channelId, 'memory');
    return cloneTicket(existing);
}

export async function releaseTicketReservation(pendingChannelId: string): Promise<void> {
    const backend = pendingBackend(pendingChannelId);
    if (backend === 'mongo' || backend === null) {
        if (!isDatabaseAvailable()) {
            deferredMongoPendingDeletes.add(pendingChannelId);
            return;
        }
        await flushDeferredMongoDeletesSafely();
        await Ticket.deleteOne({ channelId: pendingChannelId, status: 'pending' }).exec();
        backendByChannelId.delete(pendingChannelId);
        return;
    }
    if (backend === 'memory') {
        memoryTickets.delete(pendingChannelId);
        backendByChannelId.delete(pendingChannelId);
    }
}

export async function removeTicketRecord(channelId: string): Promise<void> {
    const backend = pendingBackend(channelId);
    if (backend === 'mongo' || backend === null) {
        if (!isDatabaseAvailable()) {
            deferredMongoRecordDeletes.add(channelId);
            return;
        }
        await flushDeferredMongoDeletesSafely();
        await Ticket.deleteOne({ channelId }).exec();
        backendByChannelId.delete(channelId);
        return;
    }
    if (backend === 'memory') {
        memoryTickets.delete(channelId);
        backendByChannelId.delete(channelId);
    }
}

export async function getTicketByChannel(channelId: string): Promise<TicketRecord | null> {
    const ticket = memoryTickets.get(channelId);
    if (ticket) {
        backendByChannelId.set(channelId, 'memory');
        return cloneTicket(ticket);
    }

    const backend = backendByChannelId.get(channelId);
    if (backend === 'memory' || !isDatabaseAvailable()) return null;
    await flushDeferredMongoDeletesSafely();
    const persisted = await Ticket.findOne({ channelId }).lean<TicketRecord>().exec();
    if (persisted) backendByChannelId.set(channelId, 'mongo');
    return persisted;
}

export async function updateTicket(channelId: string, updates: Partial<TicketRecord>): Promise<TicketRecord | null> {
    const memoryTicket = memoryTickets.get(channelId);
    if (memoryTicket) {
        Object.assign(memoryTicket, updates);
        memoryTickets.set(channelId, memoryTicket);
        backendByChannelId.set(channelId, 'memory');
        return cloneTicket(memoryTicket);
    }

    const backend = backendByChannelId.get(channelId);
    if (backend === 'memory' || !isDatabaseAvailable()) return null;
    if (backend === 'mongo' || isDatabaseAvailable()) {
        await flushDeferredMongoDeletesSafely();
        const persisted = await Ticket.findOneAndUpdate({ channelId }, { $set: updates }, { new: true }).lean<TicketRecord>().exec();
        if (persisted) backendByChannelId.set(channelId, 'mongo');
        return persisted;
    }
    return null;
}

export async function claimOpenTicket(channelId: string, claimantId: string): Promise<TicketRecord | null> {
    const memoryTicket = memoryTickets.get(channelId);
    if (memoryTicket) {
        if (memoryTicket.status !== 'open' || (memoryTicket.claimedBy && memoryTicket.claimedBy !== claimantId)) return null;
        memoryTicket.claimedBy = claimantId;
        memoryTicket.aiEnabled = false;
        backendByChannelId.set(channelId, 'memory');
        return cloneTicket(memoryTicket);
    }

    const backend = backendByChannelId.get(channelId);
    if (backend === 'memory' || !isDatabaseAvailable()) return null;
    if (backend === 'mongo' || isDatabaseAvailable()) {
        await flushDeferredMongoDeletesSafely();
        const persisted = await Ticket.findOneAndUpdate(
            {
                channelId,
                status: 'open',
                $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }, { claimedBy: claimantId }],
            },
            { $set: { claimedBy: claimantId, aiEnabled: false } },
            { new: true },
        ).lean<TicketRecord>().exec();
        if (persisted) backendByChannelId.set(channelId, 'mongo');
        return persisted;
    }
    return null;
}

export async function setOpeningMessage(channelId: string, openingMessageId: string): Promise<void> {
    await updateTicket(channelId, { openingMessageId });
}

export async function safelyGetTicketByChannel(channelId: string): Promise<TicketRecord | null> {
    try {
        return await getTicketByChannel(channelId);
    } catch (error) {
        logger.error(`Ticket lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}
