import type { Client, Message } from 'discord.js';
import { logger } from '../utils/logger';

// TEMPORARY OWNER SAFETY MODE
// Raid protection is intentionally disabled until the owner explicitly asks
// to turn it back on. It must not kick, ban, timeout, delete messages, block
// joins, or publish raid/unusual-join alerts while disabled.
const RAID_PROTECTION_ENABLED = false;

// Keep the previously protected application ID available for compatibility
// with any code/tests that import this helper.
const PROTECTED_BOT_IDS = new Set<string>([
    '497196352866877441',
]);

export function isProtectedBotId(userId: string | null | undefined): boolean {
    return Boolean(userId && PROTECTED_BOT_IDS.has(userId));
}

export async function handleRaidProtectionMessage(_message: Message): Promise<void> {
    // Intentionally no-op while raid protection is disabled.
}

export function registerRaidProtection(_client: Client): void {
    if (!RAID_PROTECTION_ENABLED) {
        logger.warn('[Raid Protection] DISABLED BY OWNER: no join actions, kicks, bans, timeouts, message deletions, or raid alerts will run.');
        return;
    }
}
