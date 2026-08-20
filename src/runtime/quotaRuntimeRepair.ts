import type { Client, Message } from 'discord.js';
import { connectDatabase, isDatabaseAvailable } from '../database/connection';
import { logger } from '../utils/logger';

type QuotaModule = {
    handleQuotaMessage: (message: Message) => Promise<void>;
    startMessageQuotaScheduler: (client: Client) => void;
};

let installed = false;
const recentlyHandled = new Map<string, number>();
const DEDUPE_TTL_MS = 10 * 60_000;

function pruneSeen(now: number): void {
    for (const [messageId, at] of recentlyHandled) {
        if (now - at > DEDUPE_TTL_MS) recentlyHandled.delete(messageId);
    }
}

export function installQuotaRuntimeRepair(quotaModule: QuotaModule, client: Client): void {
    if (installed) return;
    installed = true;

    const original = quotaModule.handleQuotaMessage.bind(quotaModule);
    const guardedHandler = async (message: Message): Promise<void> => {
        const now = Date.now();
        if (recentlyHandled.has(message.id)) return;
        recentlyHandled.set(message.id, now);
        if (recentlyHandled.size > 5_000) pruneSeen(now);

        try {
            await original(message);
        } catch (error) {
            logger.warn(`[QuotaRepair] Message ${message.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Replace the exported handler first. ready.ts imports this same module, so
    // any later listener registration gets the duplicate-safe handler too.
    quotaModule.handleQuotaMessage = guardedHandler;

    // Start tracking independently of the larger onReady chain. This prevents
    // slash-command registration or another optional feature from leaving quota
    // completely inactive while the bot itself is online.
    client.on('messageCreate', guardedHandler);

    // The scheduler is safe to start before Mongo is ready; its own tick checks
    // database availability. Starting it now means it automatically wakes up as
    // soon as the database reconnects.
    quotaModule.startMessageQuotaScheduler(client);

    void connectDatabase()
        .then(available => {
            logger.info(`[QuotaRepair] Database ${available ? 'connected' : 'not ready yet'}; quota listener remains active.`);
            if (available) quotaModule.startMessageQuotaScheduler(client);
        })
        .catch(error => {
            logger.warn(`[QuotaRepair] Initial database connection attempt failed: ${error instanceof Error ? error.message : String(error)}`);
        });

    // Keep a lightweight health retry running. connectDatabase() already
    // deduplicates concurrent connection attempts, so this will not create a
    // connection storm.
    setInterval(() => {
        pruneSeen(Date.now());
        if (isDatabaseAvailable()) return;
        void connectDatabase().catch(() => false);
    }, 60_000).unref?.();

    logger.info('[QuotaRepair] Independent quota listener installed; duplicate message counting protection enabled.');
}
