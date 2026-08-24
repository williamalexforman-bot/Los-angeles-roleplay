import mongoose from 'mongoose';
import { logger } from '../utils/logger';

const INITIAL_RETRY_MS = 10_000;
const MAX_RETRY_MS = 5 * 60_000;
const ATLAS_NETWORK_RETRY_MS = 15 * 60_000;

let available = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectingPromise: Promise<boolean> | null = null;
let retryAttempt = 0;
let listenersBound = false;
let shuttingDown = false;
let warnedMissingUri = false;
let warnedInvalidUri = false;
let warnedPartialSplitConfig = false;
let degradedReason: string | null = null;
let lastConnectionError = '';

function normalizeMongoHost(rawHost: string): string {
    return rawHost
        .trim()
        .replace(/^mongodb(?:\+srv)?:\/\//i, '')
        .replace(/^[^@]+@/, '')
        .split('/')[0]
        .replace(/\?.*$/, '')
        .trim();
}

/**
 * Render-safe MongoDB configuration.
 *
 * Preferred configuration uses three separate environment variables so a
 * password containing URI-reserved characters can never corrupt the Atlas
 * connection string:
 *   MONGODB_USERNAME
 *   MONGODB_PASSWORD
 *   MONGODB_HOST
 *
 * MONGODB_URI remains supported as a backwards-compatible fallback.
 */
function configuredMongoUri(): string | null {
    const username = process.env.MONGODB_USERNAME?.trim();
    const password = process.env.MONGODB_PASSWORD ?? '';
    const rawHost = process.env.MONGODB_HOST?.trim();
    const database = process.env.MONGODB_DATABASE?.trim() || 'discordbot';

    const hasAnySplitValue = Boolean(username || password || rawHost);
    if (username && password && rawHost) {
        const host = normalizeMongoHost(rawHost);
        if (!host || !host.includes('.')) {
            if (!warnedInvalidUri) {
                warnedInvalidUri = true;
                logger.warn('[MongoDB] MONGODB_HOST is invalid. Use only the Atlas hostname, for example cluster0.xxxxx.mongodb.net.');
            }
            return null;
        }

        const encodedUser = encodeURIComponent(username);
        const encodedPassword = encodeURIComponent(password);
        const encodedDatabase = encodeURIComponent(database);
        return `mongodb+srv://${encodedUser}:${encodedPassword}@${host}/${encodedDatabase}?retryWrites=true&w=majority`;
    }

    if (hasAnySplitValue && !warnedPartialSplitConfig) {
        warnedPartialSplitConfig = true;
        logger.warn('[MongoDB] Separate Render credentials are incomplete. MONGODB_USERNAME, MONGODB_PASSWORD, and MONGODB_HOST must all be set; falling back to MONGODB_URI if available.');
    }

    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        if (!warnedMissingUri) {
            warnedMissingUri = true;
            logger.warn('MongoDB is not configured. Set MONGODB_USERNAME, MONGODB_PASSWORD, and MONGODB_HOST (recommended) or MONGODB_URI. Discord features will continue in fallback mode.');
        }
        return null;
    }

    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
        if (!warnedInvalidUri) {
            warnedInvalidUri = true;
            logger.warn('MONGODB_URI is not a valid MongoDB URI; database-backed persistence is disabled. Discord features will continue in fallback mode.');
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

function looksLikeAtlasNetworkBlock(message: string): boolean {
    return /could not connect to any servers in your mongodb atlas cluster|ip.*whitelist|ip access list|server selection timed out/i.test(message);
}

function looksLikeAuthenticationFailure(message: string): boolean {
    return /bad auth|authentication failed|auth failed|authenticationfailure/i.test(message);
}

function scheduleReconnect(reason: string, connectionMessage = ''): void {
    if (shuttingDown || reconnectTimer || !configuredMongoUri()) return;

    const atlasBlocked = looksLikeAtlasNetworkBlock(connectionMessage || lastConnectionError);
    const delay = atlasBlocked
        ? ATLAS_NETWORK_RETRY_MS
        : Math.min(INITIAL_RETRY_MS * (2 ** Math.min(retryAttempt, 5)), MAX_RETRY_MS);

    retryAttempt += 1;
    logger.warn(`[MongoDB] ${reason} Bot remains online in fallback mode; retrying database in ${Math.max(1, Math.round(delay / 60_000))} minute(s).`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectDatabase();
    }, delay);
    reconnectTimer.unref?.();
}

function enterDegradedMode(message: string): void {
    available = false;
    lastConnectionError = message;
    degradedReason = looksLikeAtlasNetworkBlock(message)
        ? 'MongoDB Atlas network access is blocking the host.'
        : looksLikeAuthenticationFailure(message)
            ? 'MongoDB Atlas rejected the configured database username or password.'
            : message;
}

function bindConnectionListeners(): void {
    if (listenersBound) return;
    listenersBound = true;

    mongoose.connection.on('connected', () => {
        available = true;
        degradedReason = null;
        lastConnectionError = '';
        retryAttempt = 0;
        clearReconnectTimer();
        logger.info('[MongoDB] Connection is healthy. Persistent storage restored.');
    });

    mongoose.connection.on('reconnected', () => {
        available = true;
        degradedReason = null;
        lastConnectionError = '';
        retryAttempt = 0;
        clearReconnectTimer();
        logger.info('[MongoDB] Reconnected successfully. Persistent storage restored.');
    });

    mongoose.connection.on('disconnected', () => {
        available = false;
        degradedReason = 'MongoDB connection was lost.';
        if (!shuttingDown) scheduleReconnect('Connection was lost.');
    });

    mongoose.connection.on('error', error => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        enterDegradedMode(message);
        if (!shuttingDown && !connectingPromise) {
            logger.warn('[MongoDB] Connection error. Discord features remain available in fallback mode.');
            scheduleReconnect('Connection error detected.', message);
        }
    });
}

export async function connectDatabase(): Promise<boolean> {
    const uri = configuredMongoUri();
    if (!uri || shuttingDown) return false;

    bindConnectionListeners();

    if (mongoose.connection.readyState === 1) {
        available = true;
        degradedReason = null;
        retryAttempt = 0;
        clearReconnectTimer();
        return true;
    }

    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
        try {
            mongoose.set('strictQuery', true);
            mongoose.set('bufferCommands', false);
            mongoose.set('bufferTimeoutMS', 1_000);

            await mongoose.connect(uri, {
                serverSelectionTimeoutMS: 5_000,
                connectTimeoutMS: 5_000,
                socketTimeoutMS: 30_000,
                maxPoolSize: 10,
                minPoolSize: 0,
            });

            available = mongoose.connection.readyState === 1;
            if (available) {
                degradedReason = null;
                lastConnectionError = '';
                retryAttempt = 0;
                clearReconnectTimer();
                logger.info('[MongoDB] Connected. Persistent storage is active.');
                return true;
            }

            enterDegradedMode('Connection did not become ready.');
            scheduleReconnect('Connection did not become ready.');
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown connection error';
            enterDegradedMode(message);

            if (looksLikeAtlasNetworkBlock(message)) {
                logger.warn('[MongoDB] Atlas is currently unreachable from Render. Running in database fallback mode; Discord commands remain available.');
            } else if (looksLikeAuthenticationFailure(message)) {
                logger.warn('[MongoDB] Atlas rejected the database credentials. Verify the Render database username/password belong to the Atlas Database Access user for this cluster.');
            } else {
                logger.warn(`[MongoDB] Database unavailable. Running in fallback mode: ${message}`);
            }
            scheduleReconnect('Database unavailable.', message);
            return false;
        } finally {
            connectingPromise = null;
        }
    })();

    return connectingPromise;
}

export function isDatabaseAvailable(): boolean {
    if (mongoose.connection.readyState === 1) {
        available = true;
        degradedReason = null;
        return true;
    }

    available = false;
    const configured = Boolean(configuredMongoUri());
    if (configured && !shuttingDown && !connectingPromise && !reconnectTimer) {
        void connectDatabase();
    }
    return false;
}

export function getDatabaseStatus(): { available: boolean; degraded: boolean; reason: string | null } {
    return {
        available: isDatabaseAvailable(),
        degraded: !available,
        reason: degradedReason,
    };
}

export async function disconnectDatabase(): Promise<void> {
    shuttingDown = true;
    available = false;
    clearReconnectTimer();

    if (mongoose.connection.readyState === 0) return;
    try {
        await mongoose.disconnect();
        logger.info('[MongoDB] Disconnected.');
    } catch (error) {
        logger.warn(`MongoDB shutdown encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
