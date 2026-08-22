import { ActivityType, REST, Routes, type Client } from 'discord.js';
import { loadProhibitedWordOverrides } from '../commands/prohibitedWords';
import { connectDatabase } from '../database/connection';
import { logger } from '../utils/logger';
import { startAdvancedPaidAdScheduler } from '../commands/advancedPaidAds';
import { registerTicketAiTriage } from './ticketAiTriage';
import { registerTicketPriority } from './ticketPriority';
import { registerJoinAccountDateCorrection } from './joinAccountDateCorrection';
import { registerRaidProtection } from './raidProtection';

const MEMBER_COUNT_REFRESH_MS = 5 * 60 * 1000;
const COMMAND_PREWARM_DELAY_MS = 5_000;
const COMMAND_SYNC_DELAY_MS = 20_000;
const NONESSENTIAL_STARTUP_DELAY_MS = 5 * 60_000;
let memberCountPresenceTimer: ReturnType<typeof setInterval> | null = null;
let commandPrewarmTimer: ReturnType<typeof setTimeout> | null = null;
let commandSyncTimer: ReturnType<typeof setTimeout> | null = null;
let paidAdStartupTimer: ReturnType<typeof setTimeout> | null = null;
let commandSyncCompleted = false;

async function updateMemberCountPresence(client: Client): Promise<void> {
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;
        const guild = client.guilds.cache.get(guildId);
        const memberCount = guild?.memberCount ?? guild?.members.cache.size ?? 0;
        await client.user?.setActivity(`${memberCount} members`, { type: ActivityType.Watching });
        logger.info(`[Presence] Status updated from gateway cache: Watching ${memberCount} members.`);
    } catch (error) {
        logger.warn(`[Presence] Member-count presence update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

function scheduleCommandPrewarm(): void {
    if (commandPrewarmTimer) clearTimeout(commandPrewarmTimer);
    commandPrewarmTimer = setTimeout(() => {
        commandPrewarmTimer = null;
        const startedAt = Date.now();
        try {
            const registry = require('../commands/registry.ts') as {
                commandHandlers?: Map<string, unknown>;
                duplicateCommandNames?: string[];
            };
            const count = registry.commandHandlers instanceof Map ? registry.commandHandlers.size : 0;
            const duplicateNames = Array.isArray(registry.duplicateCommandNames) ? registry.duplicateCommandNames : [];
            logger.info(`[SlashCommands] Warmed ${count} canonical command handlers ${Date.now() - startedAt}ms after the gateway was already READY.`);
            if (duplicateNames.length) {
                logger.warn(`[SlashCommands] Local duplicate definitions were safely collapsed to one handler each: ${duplicateNames.join(', ')}`);
            }
        } catch (error) {
            logger.error(`[SlashCommands] Background command warmup failed without taking Discord offline: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        }
    }, COMMAND_PREWARM_DELAY_MS);
    commandPrewarmTimer.unref?.();
}

function scheduleOneTimeCommandSync(client: Client): void {
    if (commandSyncCompleted) return;
    if (commandSyncTimer) clearTimeout(commandSyncTimer);
    commandSyncTimer = setTimeout(() => {
        commandSyncTimer = null;
        void (async () => {
            if (commandSyncCompleted || !client.isReady() || !client.application) return;
            const token = client.token?.trim();
            const guildId = process.env.GUILD_ID?.trim() || client.guilds.cache.firstKey();
            if (!token || !guildId) {
                logger.warn('[SlashCommands] Guild sync skipped because token/application/guild information is unavailable.');
                return;
            }

            try {
                const registry = require('../commands/registry.ts') as {
                    commandDefinitions?: Array<{ data: { name: string; toJSON(): unknown } }>;
                };
                const definitions = Array.isArray(registry.commandDefinitions) ? registry.commandDefinitions : [];
                const commands = definitions.slice(0, 100).map(command => command.data.toJSON());
                if (!commands.length) throw new Error('Canonical command registry is empty.');

                // IMPORTANT: Never clear global commands before the replacement
                // guild registration succeeds. Render's shared egress has been
                // rate-limited by Discord, and deleting first can leave stale UI
                // commands with no live registration behind them.
                const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);
                logger.warn(`[SlashCommands] Uploading ${commands.length} canonical guild commands to ${guildId} without deleting existing commands first.`);

                const registered = await rest.put(
                    Routes.applicationGuildCommands(client.application.id, guildId),
                    { body: commands },
                ) as Array<{ name?: string }>;

                commandSyncCompleted = true;
                logger.info(`[SlashCommands] GUILD SYNC COMPLETE: ${registered.length} current commands installed. Existing global commands were left untouched.`);
            } catch (error) {
                const status = (error as { status?: number })?.status ?? 'unknown';
                const code = (error as { code?: string | number })?.code ?? 'unknown';
                logger.error(`[SlashCommands] Guild sync failed without deleting existing commands: status=${status} code=${code} ${error instanceof Error ? error.stack || error.message : String(error)}`);
            }
        })();
    }, COMMAND_SYNC_DELAY_MS);
    commandSyncTimer.unref?.();
    logger.info('[SlashCommands] Safe guild-only command sync scheduled 20 seconds after READY.');
}

function schedulePaidAdMaintenance(client: Client): void {
    if (paidAdStartupTimer) clearTimeout(paidAdStartupTimer);
    paidAdStartupTimer = setTimeout(() => {
        paidAdStartupTimer = null;
        try {
            startAdvancedPaidAdScheduler(client);
        } catch (error) {
            logger.warn(`[PaidAds] Delayed scheduler failed to start: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, NONESSENTIAL_STARTUP_DELAY_MS);
    paidAdStartupTimer.unref?.();
    logger.info('[PaidAds] Nonessential scheduler startup delayed 5 minutes so core Discord interactions get priority.');
}

export const onReady = async (client: Client): Promise<void> => {
    logger.info(`Logged in as ${client.user?.tag}.`);
    registerTicketAiTriage(client);
    registerTicketPriority(client);
    registerJoinAccountDateCorrection(client);
    registerRaidProtection(client);
    scheduleCommandPrewarm();
    scheduleOneTimeCommandSync(client);

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
    if (memberCountPresenceTimer) clearInterval(memberCountPresenceTimer);
    await updateMemberCountPresence(client);
    memberCountPresenceTimer = setInterval(() => void updateMemberCountPresence(client), MEMBER_COUNT_REFRESH_MS);
    schedulePaidAdMaintenance(client);
};
