import { ActivityType, type Client } from 'discord.js';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { startActivityCheckScheduler } from '../commands/activityCheck';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';
import { startAdvancedPaidAdScheduler } from '../commands/advancedPaidAds';
import { registerTicketAiTriage } from './ticketAiTriage';
import { registerTicketPriority } from './ticketPriority';
import { registerJoinAccountDateCorrection } from './joinAccountDateCorrection';
import { registerRaidProtection } from './raidProtection';

const MEMBER_COUNT_REFRESH_MS = 5 * 60 * 1000;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;

async function updateMemberCountPresence(client: Client): Promise<void> {
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;

        // Use Discord's gateway cache only. Do not force a REST fetch here: the
        // Render egress IP has been receiving Discord/Cloudflare HTTP 429s.
        const guild = client.guilds.cache.get(guildId);
        const memberCount = guild?.memberCount ?? guild?.members.cache.size ?? 0;
        await client.user?.setActivity(`${memberCount} members`, { type: ActivityType.Watching });
        logger.info(`[Presence] Status updated from gateway cache: Watching ${memberCount} members.`);
    } catch (error) {
        logger.warn(`[Presence] Member-count presence update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);

    registerTicketAiTriage(client);
    registerTicketPriority(client);
    registerJoinAccountDateCorrection(client);
    registerRaidProtection(client);

    // IMPORTANT: Do not wipe, rebuild, verify, or repair slash commands during
    // startup. Repeated deployments were generating a burst of Discord REST
    // requests and the Render shared egress IP began receiving HTTP 429s. The
    // existing Discord command registrations remain usable while the local
    // command router handles them. Command syncing should be an explicit/manual
    // maintenance action later, not part of every bot boot.
    logger.warn('[SlashCommands] Automatic startup registration/repair is DISABLED to avoid Discord REST 429s. Existing registrations are preserved.');

    try {
        await loadProhibitedWordOverrides([...client.guilds.cache.keys()]);
    } catch (error) {
        logger.warn(`Prohibited-word overrides could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    void connectDatabase().then(available => {
        logger.info(`[Database] ${available ? 'Connected.' : 'Unavailable; Discord remains online.'}`);
    }).catch(error => {
        logger.warn(`[Database] Connection failed without taking Discord offline: ${error instanceof Error ? error.message : String(error)}`);
    });

    logger.info('[Quota] Text/message quota tracking is disabled.');

    if (memberCountPresenceTimer) {
        clearInterval(memberCountPresenceTimer);
        memberCountPresenceTimer = null;
    }
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => void updateMemberCountPresence(client), MEMBER_COUNT_REFRESH_MS);

    try {
        startActivityCheckScheduler(client);
    } catch (error) {
        logger.warn(`[ActivityCheck] Scheduler failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        startAdvancedPaidAdScheduler(client);
    } catch (error) {
        logger.warn(`[PaidAds] Scheduler failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
};
