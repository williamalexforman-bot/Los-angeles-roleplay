import mongoose from 'mongoose';
import { logger } from '../utils/logger';

const INITIAL_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

let available = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectingPromise: Promise<boolean> | null = null;
let retryAttempt = 0;
let listenersBound = false;
let shuttingDown = false;
let warnedMissingUri = false;
let warnedInvalidUri = false;

function configuredMongoUri(): string | null {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        if (!warnedMissingUri) {
            warnedMissingUri = true;
            logger.warn('MONGODB_URI is not configured; persistent features cannot connect until it is added to the host environment.');
        }
        return null;
    }

    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
        if (!warnedInvalidUri) {
            warnedInvalidUri = true;
            logger.warn('MONGODB_URI is not a valid MongoDB URI; persistent features cannot connect until it is corrected.');
        }
        return null;
    }

    return uri;
}

function clearReconnectTimer(): void {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function scheduleReconnect(reason: string): void {
    if (shuttingDown || reconnectTimer || !configuredMongoUri()) return;

    const delay = Math.min(INITIAL_RETRY_MS * (2 ** Math.min(retryAttempt, 4)), MAX_RETRY_MS);
    retryAttempt += 1;
    logger.warn(`[MongoDB] ${reason} Retrying in ${Math.round(delay / 1_000)}s.`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectDatabase();
    }, delay);

    reconnectTimer.unref?.();
}

function bindConnectionListeners(): void {
    if (listenersBound) return;
    listenersBound = true;

    mongoose.connection.on('connected', () => {
        available = true;
        retryAttempt = 0;
        clearReconnectTimer();
        logger.info('[MongoDB] Connection is healthy.');
    });

    mongoose.connection.on('reconnected', () => {
        available = true;
        retryAttempt = 0;
        clearReconnectTimer();
        logger.info('[MongoDB] Reconnected successfully.');
    });

    mongoose.connection.on('disconnected', () => {
        available = false;
        if (!shuttingDown) scheduleReconnect('Connection was lost.');
    });

    mongoose.connection.on('error', error => {
        available = false;
        if (!shuttingDown) {
            logger.warn(`[MongoDB] Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            scheduleReconnect('Connection error detected.');
        }
    });
}

export async function connectDatabase(): Promise<boolean> {
    const uri = configuredMongoUri();
    if (!uri || shuttingDown) return false;

    bindConnectionListeners();

    if (mongoose.connection.readyState === 1) {
        available = true;
        retryAttempt = 0;
        clearReconnectTimer();
        return true;
    }

    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
        try {
            mongoose.set('strictQuery', true);
            mongoose.set('bufferTimeoutMS', 15_000);

            await mongoose.connect(uri, {
                serverSelectionTimeoutMS: 10_000,
                connectTimeoutMS: 10_000,
                socketTimeoutMS: 45_000,
                maxPoolSize: 10,
                minPoolSize: 0,
            });

            available = mongoose.connection.readyState === 1;
            if (available) {
                retryAttempt = 0;
                clearReconnectTimer();
                logger.info('Connected to MongoDB.');
                return true;
            }

            scheduleReconnect('Connection did not become ready.');
            return false;
        } catch (error) {
            available = false;
            const message = error instanceof Error ? error.message : 'Unknown connection error';
            logger.error(`[MongoDB] Connection unavailable: ${message}`);
            scheduleReconnect('Initial connection failed.');
            return false;
        } finally {
            connectingPromise = null;
        }
    })();

    return connectingPromise;
}

export function isDatabaseAvailable(): boolean {
    const state = mongoose.connection.readyState;

    if (state === 1) {
        available = true;
        return true;
    }

    available = false;
    const configured = Boolean(configuredMongoUri());
    if (!configured || shuttingDown) return false;

    // Start recovery immediately when a feature such as weekly quota needs the
    // database. Mongoose buffers model operations while readyState === 2, so a
    // command can wait for a healthy connection instead of instantly replying
    // that the database is unavailable during a normal reconnect/startup window.
    if (!connectingPromise && state !== 2) void connectDatabase();

    return mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2;
}

export async function disconnectDatabase(): Promise<void> {
    shuttingDown = true;
    available = false;
    clearReconnectTimer();

    if (mongoose.connection.readyState === 0) return;
    try {
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB.');
    } catch (error) {
        logger.warn(`MongoDB shutdown encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
