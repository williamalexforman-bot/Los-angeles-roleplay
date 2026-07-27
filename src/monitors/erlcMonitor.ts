import { randomUUID } from 'crypto';
import { Client, EmbedBuilder } from 'discord.js';
import {
    ErlcCommandLog,
    ErlcFetchResult,
    ErlcIdentity,
    ErlcServerSnapshot,
    fetchErlcServer,
} from '../services/erlcService';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';

export const ERLC_COMMAND_LOG_CHANNEL_ID = CHANNEL_IDS.erlcCommandLog;
export const ERLC_TEAM_CHANGE_LOG_CHANNEL_ID = CHANNEL_IDS.erlcTeamChangeLog;
export const ERLC_PUNISHMENT_LOG_CHANNEL_ID = CHANNEL_IDS.erlcPunishmentLog;

const CSRP_TEAL = 0x18b6a4;
const CSRP_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_SEEN_COMMAND_IDS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const MODERATION_COMMANDS = new Set([
    ':admin', ':ban', ':bring', ':heal', ':jail', ':kick', ':mod', ':respawn',
    ':tempban', ':to', ':unadmin', ':unban', ':unjail', ':unmod', ':unwanted', ':wanted',
]);

interface TrackedTeam {
    name: string;
    robloxId: string | null;
    team: string;
}

export interface ErlcCommandDetectedEvent {
    id: string;
    log: ErlcCommandLog;
    appearsToBeModeration: boolean;
}

export interface ErlcTeamChangedEvent {
    player: ErlcIdentity;
    previousTeam: string;
    newTeam: string;
    detectedAt: number;
}

export type ErlcPunishmentAction = 'Kick' | 'Ban' | 'Temporary Ban' | 'Unban';

export interface ErlcPunishmentCommandEvent {
    id: string;
    log: ErlcCommandLog;
    action: ErlcPunishmentAction;
    target: string;
    source: 'Detected from Command Log';
}

export type ErlcOutboxDelivery =
    | {
        id: string;
        kind: 'command';
        event: ErlcCommandDetectedEvent;
        createdAt: number;
    }
    | {
        id: string;
        kind: 'punishment';
        event: ErlcPunishmentCommandEvent;
        createdAt: number;
    }
    | {
        id: string;
        kind: 'team_change';
        event: ErlcTeamChangedEvent;
        createdAt: number;
    };

export interface ErlcMonitorState {
    version: 1;
    initialized: boolean;
    seenCommandIds: string[];
    teams: Record<string, TrackedTeam>;
    /** Durable, destination-specific Discord deliveries awaiting confirmation. */
    outbox: ErlcOutboxDelivery[];
    updatedAt: number;
}

export interface ErlcMonitorStateStore {
    load(): Promise<ErlcMonitorState | null>;
    save(state: ErlcMonitorState): Promise<void>;
}

export interface ErlcMonitorPublisher {
    commandDetected(event: ErlcCommandDetectedEvent, embed: EmbedBuilder): Promise<void>;
    teamChanged(event: ErlcTeamChangedEvent, embed: EmbedBuilder): Promise<void>;
    punishmentDetected(event: ErlcPunishmentCommandEvent, embed: EmbedBuilder): Promise<void>;
}

export type ErlcMonitorErrorContext =
    | 'load_state'
    | 'save_state'
    | 'fetch_snapshot'
    | 'publish_command'
    | 'publish_team_change'
    | 'publish_punishment';

export interface ErlcMonitorOptions {
    client?: Client;
    stateStore?: ErlcMonitorStateStore;
    publisher?: ErlcMonitorPublisher;
    fetchSnapshot?: (signal?: AbortSignal) => Promise<ErlcFetchResult>;
    commandLogChannelId?: string;
    teamChangeLogChannelId?: string;
    punishmentLogChannelId?: string;
    pollIntervalMs?: number;
    maxSeenCommandIds?: number;
    onError?: (error: Error, context: ErlcMonitorErrorContext) => void;
}

export interface ErlcPollOptions {
    /** Explicitly bypasses the monitor's local interval gate; intended for controlled tests/recovery only. */
    force?: boolean;
}

export type StartErlcMonitorOptions = Omit<ErlcMonitorOptions, 'client'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneIdentity(identity: ErlcIdentity): ErlcIdentity {
    return { ...identity };
}

function cloneCommandLog(log: ErlcCommandLog): ErlcCommandLog {
    return { ...log, player: cloneIdentity(log.player) };
}

function cloneOutboxDelivery(delivery: ErlcOutboxDelivery): ErlcOutboxDelivery {
    switch (delivery.kind) {
        case 'command':
            return {
                ...delivery,
                event: { ...delivery.event, log: cloneCommandLog(delivery.event.log) },
            };
        case 'punishment':
            return {
                ...delivery,
                event: { ...delivery.event, log: cloneCommandLog(delivery.event.log) },
            };
        case 'team_change':
            return {
                ...delivery,
                event: { ...delivery.event, player: cloneIdentity(delivery.event.player) },
            };
    }
}

function normalizeIdentity(value: unknown): ErlcIdentity | null {
    if (!isRecord(value) || typeof value.raw !== 'string' || typeof value.name !== 'string') return null;
    if (value.robloxId !== null && typeof value.robloxId !== 'string') return null;
    return { raw: value.raw, name: value.name, robloxId: value.robloxId };
}

function normalizeCommandLog(value: unknown): ErlcCommandLog | null {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.command !== 'string'
        || typeof value.timestamp !== 'number'
        || !Number.isFinite(value.timestamp)) return null;
    const player = normalizeIdentity(value.player);
    return player ? { id: value.id, player, command: value.command, timestamp: value.timestamp } : null;
}

function normalizeOutboxDelivery(value: unknown): ErlcOutboxDelivery | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isRecord(value.event)) return null;
    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now();

    if (value.kind === 'command') {
        const log = normalizeCommandLog(value.event.log);
        if (!log || typeof value.event.id !== 'string' || typeof value.event.appearsToBeModeration !== 'boolean') return null;
        return {
            id: value.id,
            kind: 'command',
            createdAt,
            event: {
                id: value.event.id,
                log,
                appearsToBeModeration: value.event.appearsToBeModeration,
            },
        };
    }

    if (value.kind === 'punishment') {
        const log = normalizeCommandLog(value.event.log);
        const validActions: ErlcPunishmentAction[] = ['Kick', 'Ban', 'Temporary Ban', 'Unban'];
        if (!log
            || typeof value.event.id !== 'string'
            || typeof value.event.action !== 'string'
            || !validActions.includes(value.event.action as ErlcPunishmentAction)
            || typeof value.event.target !== 'string') return null;
        return {
            id: value.id,
            kind: 'punishment',
            createdAt,
            event: {
                id: value.event.id,
                log,
                action: value.event.action as ErlcPunishmentAction,
                target: value.event.target,
                source: 'Detected from Command Log',
            },
        };
    }

    if (value.kind === 'team_change') {
        const player = normalizeIdentity(value.event.player);
        if (!player
            || typeof value.event.previousTeam !== 'string'
            || typeof value.event.newTeam !== 'string'
            || typeof value.event.detectedAt !== 'number'
            || !Number.isFinite(value.event.detectedAt)) return null;
        return {
            id: value.id,
            kind: 'team_change',
            createdAt,
            event: {
                player,
                previousTeam: value.event.previousTeam,
                newTeam: value.event.newTeam,
                detectedAt: value.event.detectedAt,
            },
        };
    }

    return null;
}

function defaultState(): ErlcMonitorState {
    return {
        version: 1,
        initialized: false,
        seenCommandIds: [],
        teams: {},
        outbox: [],
        updatedAt: Date.now(),
    };
}

function cloneState(state: ErlcMonitorState): ErlcMonitorState {
    return {
        version: 1,
        initialized: state.initialized,
        seenCommandIds: [...state.seenCommandIds],
        teams: Object.fromEntries(
            Object.entries(state.teams).map(([key, value]) => [key, { ...value }]),
        ),
        outbox: (state.outbox ?? []).map(cloneOutboxDelivery),
        updatedAt: state.updatedAt,
    };
}

function normalizeState(value: ErlcMonitorState | null): ErlcMonitorState {
    if (!value || value.version !== 1) return defaultState();

    const teams: Record<string, TrackedTeam> = {};
    if (value.teams && typeof value.teams === 'object') {
        for (const [key, team] of Object.entries(value.teams)) {
            if (!team || typeof team.name !== 'string' || typeof team.team !== 'string') continue;
            teams[key] = {
                name: team.name,
                robloxId: typeof team.robloxId === 'string' ? team.robloxId : null,
                team: team.team,
            };
        }
    }

    const outbox: ErlcOutboxDelivery[] = [];
    const outboxIds = new Set<string>();
    if (Array.isArray(value.outbox)) {
        for (const rawDelivery of value.outbox) {
            const delivery = normalizeOutboxDelivery(rawDelivery);
            if (!delivery || outboxIds.has(delivery.id)) continue;
            outboxIds.add(delivery.id);
            outbox.push(delivery);
        }
    }

    return {
        version: 1,
        initialized: value.initialized === true,
        seenCommandIds: Array.isArray(value.seenCommandIds)
            ? value.seenCommandIds.filter(id => typeof id === 'string')
            : [],
        teams,
        outbox,
        updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
            ? value.updatedAt
            : Date.now(),
    };
}

function playerKey(identity: ErlcIdentity): string {
    return identity.robloxId
        ? `id:${identity.robloxId}`
        : `name:${identity.name.toLocaleLowerCase('en-US')}`;
}

function teamMap(snapshot: ErlcServerSnapshot): Record<string, TrackedTeam> {
    const teams: Record<string, TrackedTeam> = {};
    for (const player of snapshot.players) {
        teams[playerKey(player.player)] = {
            name: player.player.name,
            robloxId: player.player.robloxId,
            team: player.team,
        };
    }
    return teams;
}

function commandToken(command: string): string {
    return command.trim().split(/\s+/, 1)[0]?.toLocaleLowerCase('en-US') ?? '';
}

export function appearsToBeModerationCommand(command: string): boolean {
    return MODERATION_COMMANDS.has(commandToken(command));
}

export function parsePunishmentCommand(command: string): {
    action: ErlcPunishmentAction;
    target: string;
} | null {
    const match = command.trim().match(/^:(kick|ban|tempban|unban)(?:\s+(.+))?$/i);
    if (!match) return null;

    const actionMap: Record<string, ErlcPunishmentAction> = {
        kick: 'Kick',
        ban: 'Ban',
        tempban: 'Temporary Ban',
        unban: 'Unban',
    };
    const enteredTarget = match[2]?.trim().split(/\s+/, 1)[0];
    return {
        action: actionMap[match[1].toLocaleLowerCase('en-US')],
        target: enteredTarget || 'Not supplied',
    };
}

function enumerateCommandLogs(logs: ErlcCommandLog[]): Array<{ id: string; log: ErlcCommandLog }> {
    const occurrences = new Map<string, number>();
    return logs.map(log => {
        const occurrence = (occurrences.get(log.id) ?? 0) + 1;
        occurrences.set(log.id, occurrence);
        return { id: `${log.id}:${occurrence}`, log };
    });
}

function cleanEmbedValue(value: string, maxLength = 1_024): string {
    const cleaned = value
        .replace(/@/g, '@\u200b')
        .replace(/`/g, 'ˋ')
        .trim();
    if (!cleaned) return 'Unknown';
    return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}

function discordTimestamp(timestampSeconds: number): string {
    return timestampSeconds > 0 ? `<t:${Math.floor(timestampSeconds)}:F>` : 'Unknown';
}

export function buildCommandLogEmbed(event: ErlcCommandDetectedEvent): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(CSRP_TEAL)
        .setTitle('ER:LC Command Detected')
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Roblox Player', value: cleanEmbedValue(event.log.player.name), inline: true },
            { name: 'Roblox ID', value: event.log.player.robloxId ?? 'Unavailable', inline: true },
            { name: 'Moderation Command', value: event.appearsToBeModeration ? 'Yes' : 'No', inline: true },
            { name: 'Command', value: `\`${cleanEmbedValue(event.log.command, 1_000)}\`` },
            { name: 'Executed', value: discordTimestamp(event.log.timestamp) },
        )
        .setFooter({ text: CSRP_FOOTER })
        .setTimestamp(new Date(event.log.timestamp * 1_000));
}

export function buildTeamChangeEmbed(event: ErlcTeamChangedEvent): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(CSRP_TEAL)
        .setTitle('ER:LC Team Changed')
        .setThumbnail(BRAND.logoUrl)
        .addFields(
            { name: 'Player', value: cleanEmbedValue(event.player.name), inline: true },
            { name: 'Roblox ID', value: event.player.robloxId ?? 'Unavailable', inline: true },
            { name: 'Previous Team', value: cleanEmbedValue(event.previousTeam), inline: true },
            { name: 'New Team', value: cleanEmbedValue(event.newTeam), inline: true },
            { name: 'Detected', value: discordTimestamp(event.detectedAt) },
        )
        .setFooter({ text: CSRP_FOOTER })
        .setTimestamp(new Date(event.detectedAt * 1_000));
}

export function buildPunishmentCommandEmbed(event: ErlcPunishmentCommandEvent): EmbedBuilder {
    const article = event.action === 'Unban' ? 'An' : 'A';
    return new EmbedBuilder()
        .setColor(CSRP_TEAL)
        .setTitle('ER:LC Punishment Command Detected')
        .setThumbnail(BRAND.logoUrl)
        .setDescription(
            `${article} ${event.action.toLocaleLowerCase('en-US')} command was executed. `
            + 'This confirms only that the command appeared in the ER:LC command log; it does not confirm the outcome.',
        )
        .addFields(
            { name: 'Staff Member', value: cleanEmbedValue(event.log.player.name), inline: true },
            { name: 'Staff Roblox ID', value: event.log.player.robloxId ?? 'Unavailable', inline: true },
            { name: 'Action', value: event.action, inline: true },
            { name: 'Target Entered', value: cleanEmbedValue(event.target), inline: true },
            { name: 'Source', value: event.source, inline: true },
            { name: 'Command', value: `\`${cleanEmbedValue(event.log.command, 1_000)}\`` },
            { name: 'Executed', value: discordTimestamp(event.log.timestamp) },
        )
        .setFooter({ text: CSRP_FOOTER })
        .setTimestamp(new Date(event.log.timestamp * 1_000));
}

export class MemoryErlcMonitorStateStore implements ErlcMonitorStateStore {
    private state: ErlcMonitorState | null = null;

    async load(): Promise<ErlcMonitorState | null> {
        return this.state ? cloneState(this.state) : null;
    }

    async save(state: ErlcMonitorState): Promise<void> {
        this.state = cloneState(state);
    }
}

export class ErlcMonitor {
    private readonly options: ErlcMonitorOptions;
    private readonly pollIntervalMs: number;
    private readonly maxSeenCommandIds: number;
    private readonly publisher: ErlcMonitorPublisher;
    private state = defaultState();
    private stateLoaded = false;
    private running = false;
    private timer: NodeJS.Timeout | null = null;
    private activeAbortController: AbortController | null = null;
    private activePoll: Promise<ErlcFetchResult | null> | null = null;
    private consecutiveAuthenticationFailures = 0;
    private nextAllowedRequestAt = 0;
    private hasProcessedSnapshotThisRun = false;

    constructor(options: ErlcMonitorOptions) {
        this.options = options;
        const requestedPollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.pollIntervalMs = Number.isFinite(requestedPollInterval)
            ? Math.max(5_000, Math.min(MAX_TIMER_DELAY_MS, Math.floor(requestedPollInterval)))
            : DEFAULT_POLL_INTERVAL_MS;
        const requestedSeenLimit = options.maxSeenCommandIds ?? DEFAULT_MAX_SEEN_COMMAND_IDS;
        this.maxSeenCommandIds = Number.isFinite(requestedSeenLimit)
            ? Math.max(100, Math.floor(requestedSeenLimit))
            : DEFAULT_MAX_SEEN_COMMAND_IDS;
        if (!options.publisher && !options.client) {
            throw new Error('ErlcMonitor requires either a Discord client or a custom publisher.');
        }
        this.publisher = options.publisher ?? this.createDiscordPublisher(options.client);
    }

    async start(): Promise<void> {
        if (this.running) return;
        await this.ensureStateLoaded();
        this.consecutiveAuthenticationFailures = 0;
        this.running = true;
        this.schedule(0);
    }

    stop(): void {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.activeAbortController?.abort();
    }

    isRunning(): boolean {
        return this.running;
    }

    getState(): ErlcMonitorState {
        return cloneState(this.state);
    }

    getNextAllowedRequestAt(): number {
        return this.nextAllowedRequestAt;
    }

    async pollNow(options: ErlcPollOptions = {}): Promise<ErlcFetchResult | null> {
        if (this.activePoll) return this.activePoll;
        if (!options.force && Date.now() < this.nextAllowedRequestAt) return null;
        this.activePoll = this.performPoll().finally(() => {
            this.activePoll = null;
        });
        return this.activePoll;
    }

    private async performPoll(): Promise<ErlcFetchResult | null> {
        await this.ensureStateLoaded();
        const controller = new AbortController();
        this.activeAbortController = controller;

        let result: ErlcFetchResult;
        try {
            const fetchSnapshot = this.options.fetchSnapshot ?? ((signal?: AbortSignal) => fetchErlcServer({ signal }));
            result = await fetchSnapshot(controller.signal);
        } catch (error) {
            this.reportError(error, 'fetch_snapshot');
            this.nextAllowedRequestAt = Date.now() + this.pollIntervalMs;
            await this.drainOutbox();
            return null;
        } finally {
            if (this.activeAbortController === controller) this.activeAbortController = null;
        }

        const serverNextRequestAt = Number.isFinite(result.nextRequestAt)
            ? result.nextRequestAt
            : Date.now();
        this.nextAllowedRequestAt = Math.max(
            Date.now() + this.pollIntervalMs,
            serverNextRequestAt,
        );

        if (result.ok) {
            this.consecutiveAuthenticationFailures = 0;
            await this.processSnapshot(result.data);
        } else if (result.status === 'unauthorized') {
            this.consecutiveAuthenticationFailures += 1;
            if (this.consecutiveAuthenticationFailures >= 3 && this.running) {
                this.running = false;
                this.reportError(
                    new Error('ER:LC monitoring stopped after repeated authentication failures.'),
                    'fetch_snapshot',
                );
            }
            await this.drainOutbox();
        } else {
            this.consecutiveAuthenticationFailures = 0;
            await this.drainOutbox();
        }
        return result;
    }

    private enqueueDelivery(delivery: ErlcOutboxDelivery): void {
        if (this.state.outbox.some(pending => pending.id === delivery.id)) return;
        this.state.outbox.push(cloneOutboxDelivery(delivery));
    }

    private removeDelivery(deliveryId: string): void {
        this.state.outbox = this.state.outbox.filter(delivery => delivery.id !== deliveryId);
    }

    private async drainOutbox(): Promise<void> {
        for (const delivery of [...this.state.outbox]) {
            if (!this.state.outbox.some(pending => pending.id === delivery.id)) continue;

            try {
                switch (delivery.kind) {
                    case 'command':
                        await this.publisher.commandDetected(delivery.event, buildCommandLogEmbed(delivery.event));
                        break;
                    case 'punishment':
                        await this.publisher.punishmentDetected(
                            delivery.event,
                            buildPunishmentCommandEmbed(delivery.event),
                        );
                        break;
                    case 'team_change':
                        await this.publisher.teamChanged(delivery.event, buildTeamChangeEmbed(delivery.event));
                        break;
                }
            } catch (error) {
                const context: ErlcMonitorErrorContext = delivery.kind === 'command'
                    ? 'publish_command'
                    : delivery.kind === 'punishment'
                        ? 'publish_punishment'
                        : 'publish_team_change';
                this.reportError(error, context);
                continue;
            }

            this.removeDelivery(delivery.id);
            this.state.updatedAt = Date.now();
            await this.saveState();
        }
    }

    private async processSnapshot(snapshot: ErlcServerSnapshot): Promise<void> {
        const enumeratedLogs = enumerateCommandLogs(snapshot.commandLogs);
        const currentTeams = teamMap(snapshot);
        const suppressTeamChanges = !this.hasProcessedSnapshotThisRun;
        this.hasProcessedSnapshotThisRun = true;

        if (!this.state.initialized) {
            this.state.initialized = true;
            this.state.seenCommandIds = enumeratedLogs.map(item => item.id).slice(-this.maxSeenCommandIds);
            this.state.teams = currentTeams;
            this.state.updatedAt = Date.now();
            await this.saveState();
            await this.drainOutbox();
            return;
        }

        const seen = new Set(this.state.seenCommandIds);
        const newLogs = enumeratedLogs
            .filter(item => !seen.has(item.id))
            .sort((left, right) => left.log.timestamp - right.log.timestamp);

        for (const item of newLogs) {
            const event: ErlcCommandDetectedEvent = {
                id: item.id,
                log: item.log,
                appearsToBeModeration: appearsToBeModerationCommand(item.log.command),
            };
            const commandMarker = `${item.id}:command`;
            const punishmentMarker = `${item.id}:punishment`;
            const punishment = parsePunishmentCommand(item.log.command);
            const commandDeliveryId = `command:${item.id}`;
            const punishmentDeliveryId = `punishment:${item.id}`;

            // Existing destination markers mean that destination was already published by
            // the pre-outbox monitor. Honor them while migrating, and enqueue only the
            // missing destination so upgrades never replay a successful delivery.
            if (seen.has(commandMarker)) {
                this.removeDelivery(commandDeliveryId);
            } else {
                this.enqueueDelivery({
                    id: commandDeliveryId,
                    kind: 'command',
                    event,
                    createdAt: Date.now(),
                });
            }

            if (punishment) {
                const punishmentEvent: ErlcPunishmentCommandEvent = {
                    id: item.id,
                    log: item.log,
                    action: punishment.action,
                    target: punishment.target,
                    source: 'Detected from Command Log',
                };
                if (seen.has(punishmentMarker)) {
                    this.removeDelivery(punishmentDeliveryId);
                } else {
                    this.enqueueDelivery({
                        id: punishmentDeliveryId,
                        kind: 'punishment',
                        event: punishmentEvent,
                        createdAt: Date.now(),
                    });
                }
            } else {
                this.removeDelivery(punishmentDeliveryId);
            }

            // Once every missing destination is durably represented in the outbox, the
            // source log itself is complete. This keeps retries independent of API aging.
            this.state.seenCommandIds = this.state.seenCommandIds.filter(
                id => id !== commandMarker && id !== punishmentMarker,
            );
            seen.delete(commandMarker);
            seen.delete(punishmentMarker);
            seen.add(item.id);
            this.state.seenCommandIds.push(item.id);

            this.state.seenCommandIds = this.state.seenCommandIds.slice(-this.maxSeenCommandIds);
            this.state.updatedAt = Date.now();
            await this.saveState();
        }

        this.state.seenCommandIds = this.state.seenCommandIds.slice(-this.maxSeenCommandIds);

        // A process restart always gets a fresh team baseline. Persisted command IDs are
        // still honored below so genuinely new commands are not replayed or discarded.
        if (suppressTeamChanges) {
            this.state.teams = currentTeams;
            this.state.updatedAt = Date.now();
            await this.saveState();
            await this.drainOutbox();
            return;
        }

        for (const [key, current] of Object.entries(currentTeams)) {
            const previous = this.state.teams[key];
            if (!previous || previous.team === current.team) continue;

            const event: ErlcTeamChangedEvent = {
                player: {
                    raw: current.robloxId ? `${current.name}:${current.robloxId}` : current.name,
                    name: current.name,
                    robloxId: current.robloxId,
                },
                previousTeam: previous.team,
                newTeam: current.team,
                detectedAt: Math.floor(Date.now() / 1_000),
            };
            this.enqueueDelivery({
                id: `team-change:${randomUUID()}`,
                kind: 'team_change',
                event,
                createdAt: Date.now(),
            });
        }

        // The team baseline advances when the transition is captured, not when Discord is
        // available. Pending transitions now remain in the outbox after a player leaves and
        // distinct A→B→C changes are retained rather than collapsed.
        this.state.teams = currentTeams;
        this.state.updatedAt = Date.now();
        await this.saveState();
        await this.drainOutbox();
    }

    private createDiscordPublisher(client?: Client): ErlcMonitorPublisher {
        const send = async (channelId: string, embed: EmbedBuilder): Promise<void> => {
            if (!client) return;
            const channel = await client.channels.fetch(channelId);
            if (!channel?.isSendable()) throw new Error(`ER:LC log channel ${channelId} is unavailable.`);
            await channel.send({ embeds: [embed], files: [createLogoAttachment()], allowedMentions: { parse: [] } });
        };

        return {
            commandDetected: async (_event, embed) => send(
                this.options.commandLogChannelId ?? ERLC_COMMAND_LOG_CHANNEL_ID,
                embed,
            ),
            teamChanged: async (_event, embed) => send(
                this.options.teamChangeLogChannelId ?? ERLC_TEAM_CHANGE_LOG_CHANNEL_ID,
                embed,
            ),
            punishmentDetected: async (_event, embed) => send(
                this.options.punishmentLogChannelId ?? ERLC_PUNISHMENT_LOG_CHANNEL_ID,
                embed,
            ),
        };
    }

    private async ensureStateLoaded(): Promise<void> {
        if (this.stateLoaded) return;
        this.stateLoaded = true;
        if (!this.options.stateStore) return;

        try {
            this.state = normalizeState(await this.options.stateStore.load());
            this.state.seenCommandIds = this.state.seenCommandIds.slice(-this.maxSeenCommandIds);
        } catch (error) {
            this.reportError(error, 'load_state');
            this.state = defaultState();
        }
    }

    private async saveState(): Promise<void> {
        if (!this.options.stateStore) return;
        try {
            await this.options.stateStore.save(cloneState(this.state));
        } catch (error) {
            this.reportError(error, 'save_state');
        }
    }

    private schedule(delayMs: number): void {
        if (!this.running) return;
        if (this.timer) clearTimeout(this.timer);
        const safeDelay = Number.isFinite(delayMs)
            ? Math.max(0, Math.min(MAX_TIMER_DELAY_MS, Math.floor(delayMs)))
            : this.pollIntervalMs;
        this.timer = setTimeout(() => void this.runScheduledPoll(), safeDelay);
    }

    private async runScheduledPoll(): Promise<void> {
        if (!this.running) return;
        const result = await this.pollNow();
        if (!this.running) return;

        const requestedDelay = this.nextAllowedRequestAt - Date.now();
        const delay = Number.isFinite(requestedDelay)
            ? Math.max(1_000, requestedDelay)
            : this.pollIntervalMs;
        this.schedule(delay);
    }

    private reportError(error: unknown, context: ErlcMonitorErrorContext): void {
        const safeError = error instanceof Error ? error : new Error('Unknown ER:LC monitor error.');
        this.options.onError?.(safeError, context);
    }
}

export async function startErlcMonitor(
    client: Client,
    options: StartErlcMonitorOptions = {},
): Promise<ErlcMonitor> {
    const monitor = new ErlcMonitor({ ...options, client });
    await monitor.start();
    return monitor;
}
