import { createHash } from 'node:crypto';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import {
    EmergencyDispatchCall,
    type EmergencyDispatchCallRecord,
    type EmergencyDispatchClosestUnit,
} from '../database/emergencyDispatchCallModel';
import { logger } from '../utils/logger';

const ERLC_SERVER_ENDPOINT = 'https://api.erlc.gg/v2/server';
const ERLC_POSTAL_MAP_URL = 'https://api.policeroleplay.community/maps/fall_postals.png';
const EMERGENCY_CALL_CHANNEL_ID = '1538695671081861221';
const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 9_000;
const PANEL_COLOR = 0x247bf1;
const MAX_SEEN = 500;

let timer: ReturnType<typeof setInterval> | null = null;
let requestRunning = false;
let nextAllowedRequestAt = 0;
const seenIds = new Set<string>();

type UnknownRecord = Record<string, unknown>;

interface ParsedPlayer {
    robloxId: string | null;
    username: string;
    team: string;
    callsign: string | null;
    location: { x: number; z: number; postalCode: string | null; streetName: string | null } | null;
}

interface ParsedCall {
    team: string;
    callerKey: string;
    callerRobloxId: string;
    callerLabel: string;
    positionX: number;
    positionZ: number;
    startedAt: number;
    callNumber: number;
    description: string;
    positionDescriptor: string;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function unixSeconds(value: unknown): number | null {
    const parsed = asNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return Math.floor(parsed >= 1_000_000_000_000 ? parsed / 1_000 : parsed);
}

function parseIdentity(value: unknown): { username: string; robloxId: string | null } {
    const raw = asText(value) || '';
    const split = raw.lastIndexOf(':');
    if (split > 0 && split < raw.length - 1) {
        const username = raw.slice(0, split).trim();
        const id = raw.slice(split + 1).trim();
        if (username && /^\d+$/.test(id)) return { username, robloxId: id };
    }
    return { username: raw || 'Unknown', robloxId: null };
}

function parsePlayer(value: unknown): ParsedPlayer | null {
    if (!isRecord(value)) return null;
    const identity = parseIdentity(value.Player ?? value.player);
    const team = asText(value.Team ?? value.team);
    if (!team || identity.username === 'Unknown') return null;

    const locationValue = isRecord(value.Location) ? value.Location : isRecord(value.location) ? value.location : null;
    let location: ParsedPlayer['location'] = null;
    if (locationValue) {
        const x = asNumber(locationValue.LocationX ?? locationValue.x ?? locationValue.X);
        const z = asNumber(locationValue.LocationZ ?? locationValue.z ?? locationValue.Z);
        if (x !== null && z !== null) {
            location = {
                x,
                z,
                postalCode: asText(locationValue.PostalCode ?? locationValue.postal),
                streetName: asText(locationValue.StreetName ?? locationValue.street),
            };
        }
    }

    return {
        robloxId: identity.robloxId,
        username: identity.username,
        team,
        callsign: asText(value.Callsign ?? value.callsign),
        location,
    };
}

function parseCaller(value: unknown): { key: string; robloxId: string; label: string } {
    const numeric = asNumber(value);
    if (numeric !== null && numeric > 0) {
        const id = String(Math.trunc(numeric));
        return { key: `id:${id}`, robloxId: id, label: '' };
    }

    const raw = asText(value);
    if (raw) {
        const identity = parseIdentity(raw);
        if (identity.robloxId) return { key: `id:${identity.robloxId}`, robloxId: identity.robloxId, label: identity.username };
        return { key: `system:${raw.toLowerCase()}`, robloxId: 'System', label: raw };
    }
    return { key: 'system', robloxId: 'System', label: 'System' };
}

function fallbackCallNumber(value: UnknownRecord, startedAt: number): number {
    const seed = JSON.stringify([
        asText(value.Description ?? value.description ?? value.Message ?? value.message) || '',
        asText(value.PositionDescriptor ?? value.location ?? value.Location) || '',
        startedAt,
    ]);
    const hex = createHash('sha256').update(seed).digest('hex').slice(0, 7);
    return 100_000 + (parseInt(hex, 16) % 900_000);
}

function parseCall(value: unknown): ParsedCall | null {
    if (!isRecord(value)) return null;

    const position = Array.isArray(value.Position)
        ? value.Position
        : Array.isArray(value.position)
            ? value.position
            : [];
    const x = asNumber(position[0] ?? value.LocationX ?? value.x ?? value.X) ?? 0;
    const z = asNumber(position[1] ?? value.LocationZ ?? value.z ?? value.Z) ?? 0;
    const startedAt = unixSeconds(value.StartedAt ?? value.startedAt ?? value.Timestamp ?? value.timestamp)
        ?? Math.floor(Date.now() / 1_000);
    const explicitNumber = asNumber(value.CallNumber ?? value.callNumber ?? value.Number ?? value.number);
    const caller = parseCaller(value.Caller ?? value.caller ?? value.Player ?? value.player ?? value.User ?? value.user);

    const description = asText(value.Description ?? value.description ?? value.Message ?? value.message ?? value.Incident ?? value.incident)
        || '911 emergency call received.';
    const positionDescriptor = asText(
        value.PositionDescriptor
        ?? value.positionDescriptor
        ?? value.LocationDescriptor
        ?? value.locationDescriptor
        ?? value.Location
        ?? value.location,
    ) || (x !== 0 || z !== 0 ? `ER:LC coordinates X ${x.toFixed(1)}, Z ${z.toFixed(1)}` : 'Location unavailable.');

    return {
        team: asText(value.Team ?? value.team ?? value.Service ?? value.service) || 'Emergency Services',
        callerKey: caller.key,
        callerRobloxId: caller.robloxId,
        callerLabel: caller.label,
        positionX: x,
        positionZ: z,
        startedAt,
        callNumber: explicitNumber === null ? fallbackCallNumber(value, startedAt) : Math.trunc(explicitNumber),
        description,
        positionDescriptor,
    };
}

function findCallInWebhook(value: unknown, depth = 0): ParsedCall | null {
    if (depth > 5 || !isRecord(value)) return null;
    const hasCallShape = [
        'CallNumber', 'callNumber', 'Position', 'position', 'StartedAt', 'startedAt',
        'PositionDescriptor', 'positionDescriptor', 'Description', 'description',
    ].some(key => key in value);
    if (hasCallShape) {
        const parsed = parseCall(value);
        if (parsed) return parsed;
    }
    for (const child of Object.values(value)) {
        if (!isRecord(child)) continue;
        const nested = findCallInWebhook(child, depth + 1);
        if (nested) return nested;
    }
    return null;
}

function callId(guildId: string, call: ParsedCall): string {
    return createHash('sha256')
        .update(`${guildId}:${call.callNumber}:${call.startedAt}:${call.callerKey}:${call.description}`)
        .digest('hex')
        .slice(0, 16);
}

function remember(id: string): void {
    seenIds.add(id);
    while (seenIds.size > MAX_SEEN) {
        const first = seenIds.values().next().value as string | undefined;
        if (!first) break;
        seenIds.delete(first);
    }
}

function serviceLabel(team: string): string {
    const lower = team.toLowerCase();
    if (lower.includes('police') || lower.includes('sheriff') || lower.includes('law')) return 'Law Enforcement';
    if (lower.includes('fire') || lower.includes('ems') || lower.includes('medical')) return 'Fire & Rescue';
    return team || 'Emergency Services';
}

function matchingUnit(callTeam: string, playerTeam: string): boolean {
    const call = callTeam.toLowerCase();
    const team = playerTeam.toLowerCase();
    if (call.includes('police') || call.includes('sheriff') || call.includes('law')) {
        return team.includes('police') || team.includes('sheriff');
    }
    if (call.includes('fire') || call.includes('ems') || call.includes('medical')) {
        return team.includes('fire') || team.includes('ems') || team.includes('medical');
    }
    return call === team;
}

function closestUnits(call: ParsedCall, players: ParsedPlayer[]): EmergencyDispatchClosestUnit[] {
    return players
        .filter(player => player.location && matchingUnit(call.team, player.team))
        .map(player => {
            const dx = player.location!.x - call.positionX;
            const dz = player.location!.z - call.positionZ;
            return {
                robloxId: player.robloxId || undefined,
                robloxUsername: player.username,
                callsign: player.callsign || undefined,
                team: player.team,
                postalCode: player.location!.postalCode || undefined,
                streetName: player.location!.streetName || undefined,
                distance: Math.sqrt((dx * dx) + (dz * dz)),
            };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
}

function clean(value: string, max = 1_400): string {
    const result = value.replace(/```/g, "'''").replace(/@/g, '@\u200b').trim();
    if (!result) return 'Unavailable';
    return result.length <= max ? result : `${result.slice(0, max - 1)}…`;
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function mapGallery(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(ERLC_POSTAL_MAP_URL).setDescription('ER:LC postal map'),
    );
}

function closestText(record: EmergencyDispatchCallRecord): string {
    if (!record.closestUnits.length) return '*No nearby matching units were available in the current player snapshot.*';
    return record.closestUnits.map((unit, index) => {
        const callsign = unit.callsign ? `${clean(unit.callsign, 40)} • ` : '';
        const location = [unit.streetName, unit.postalCode ? `Postal ${unit.postalCode}` : null].filter(Boolean).join(' • ');
        return `**${index + 1}.** ${callsign}${clean(unit.robloxUsername, 80)}${location ? ` — ${clean(location, 120)}` : ''}`;
    }).join('\n');
}

function panel(record: EmergencyDispatchCallRecord, controlsEnabled: boolean, includeMap: boolean): ContainerBuilder {
    const callerId = /^\d+$/.test(record.callerRobloxId) ? ` • Roblox ID \`${record.callerRobloxId}\`` : '';
    const container = new ContainerBuilder()
        .setAccentColor(PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 📞 911 Call Received: ${serviceLabel(record.team)}`,
            `**Caller:** ${clean(record.callerRobloxUsername, 90)}${callerId}`,
            `**Incident:** ${clean(record.description, 1_000)}`,
            `**Location:** ${clean(record.positionDescriptor, 500)}`,
            `**Call Number:** \`${record.callNumber}\``,
            `**Time:** <t:${record.startedAt}:F> • <t:${record.startedAt}:R>`,
            '**Status:** 🟢 **Active**',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🚔 Closest Units',
            closestText(record),
            '',
            '### 👥 Assigned Units',
            '*No units assigned yet.*',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🗺️ ER:LC Call Location',
            `📍 **X:** \`${record.positionX.toFixed(1)}\` • **Z:** \`${record.positionZ.toFixed(1)}\``,
            `**Location:** ${clean(record.positionDescriptor, 500)}`,
        ].join('\n')));

    if (includeMap) container.addMediaGalleryComponents(mapGallery());

    container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            controlsEnabled
                ? '### 📝 Dispatch Notes\n*No dispatch notes added yet.*'
                : '### 📝 Dispatch Notes\n*Alert posted successfully. Dispatch controls are temporarily unavailable because persistent storage is offline.*',
        ))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`dispatch3:attach:${record.dispatchId}`)
                .setLabel('Attach Units')
                .setEmoji('🚓')
                .setStyle(ButtonStyle.Success)
                .setDisabled(!controlsEnabled),
            new ButtonBuilder()
                .setCustomId(`dispatch3:notes:${record.dispatchId}`)
                .setLabel('Add Notes')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!controlsEnabled),
            new ButtonBuilder()
                .setCustomId(`dispatch3:end:${record.dispatchId}`)
                .setLabel('End Call')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!controlsEnabled),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `*Los Angeles Roleplay • 911 Emergency Dispatch • Call #${record.callNumber}*`,
        ));

    return container;
}

async function callerName(call: ParsedCall, players: ParsedPlayer[]): Promise<string> {
    if (!/^\d+$/.test(call.callerRobloxId)) return call.callerLabel || 'System';
    const live = players.find(player => player.robloxId === call.callerRobloxId)?.username;
    if (live) return live;
    if (call.callerLabel) return call.callerLabel;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(call.callerRobloxId)}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) return `Roblox User ${call.callerRobloxId}`;
        const body = await response.json().catch(() => null);
        return isRecord(body) && asText(body.name) ? asText(body.name)! : `Roblox User ${call.callerRobloxId}`;
    } catch {
        return `Roblox User ${call.callerRobloxId}`;
    } finally {
        clearTimeout(timeout);
    }
}

async function mapIsReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
        const response = await fetch(ERLC_POSTAL_MAP_URL, { method: 'GET', signal: controller.signal });
        try { await response.body?.cancel(); } catch { /* ignore */ }
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

function makeRecord(guildId: string, id: string, call: ParsedCall, players: ParsedPlayer[], name: string): EmergencyDispatchCallRecord {
    const now = new Date();
    return {
        dispatchId: id,
        guildId,
        callNumber: call.callNumber,
        startedAt: call.startedAt,
        team: call.team,
        callerRobloxId: call.callerRobloxId,
        callerRobloxUsername: name,
        description: call.description,
        positionDescriptor: call.positionDescriptor,
        positionX: call.positionX,
        positionZ: call.positionZ,
        closestUnits: closestUnits(call, players),
        assignedDiscordIds: [],
        notes: [],
        status: 'Active',
        channelId: EMERGENCY_CALL_CHANNEL_ID,
        messageId: '',
        createdAt: now,
        updatedAt: now,
    };
}

async function postCall(client: Client, guildId: string, call: ParsedCall, players: ParsedPlayer[]): Promise<void> {
    const id = callId(guildId, call);
    if (seenIds.has(id)) return;

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Reliable] Cannot send to ${EMERGENCY_CALL_CHANNEL_ID}; check View Channel and Send Messages permissions.`);
        return;
    }

    const name = await callerName(call, players);
    let record = makeRecord(guildId, id, call, players, name);

    // POST FIRST. Database persistence and the map must never be able to block the emergency alert.
    const message = await channel.send({
        components: [panel(record, false, false)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    remember(id);

    let controlsEnabled = false;
    if (isDatabaseAvailable()) {
        try {
            const saved = await EmergencyDispatchCall.findOneAndUpdate(
                { dispatchId: id },
                {
                    $setOnInsert: {
                        ...record,
                        messageId: message.id,
                        channelId: message.channelId,
                    },
                    $set: {
                        messageId: message.id,
                        channelId: message.channelId,
                        updatedAt: new Date(),
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).lean().exec();
            if (saved) {
                record = saved as unknown as EmergencyDispatchCallRecord;
                controlsEnabled = true;
            }
        } catch (error) {
            logger.warn(`[911 Reliable] Alert posted, but persistence failed for call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    const includeMap = await mapIsReachable();
    if (controlsEnabled || includeMap) {
        await message.edit({
            components: [panel(record, controlsEnabled, includeMap)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(error => {
            logger.warn(`[911 Reliable] Call #${call.callNumber} posted, but enhancement edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }

    logger.info(`[911 Reliable] Posted ER:LC 911 call #${call.callNumber} to ${EMERGENCY_CALL_CHANNEL_ID}.`);
}

function getServerKey(): string {
    return (
        process.env.ERLC_SERVER_KEY
        || process.env.PRC_SERVER_KEY
        || process.env.PRC_API_KEY
        || process.env.SERVER_KEY
        || ''
    ).trim();
}

async function fetchSnapshot(): Promise<{ calls: ParsedCall[]; players: ParsedPlayer[] } | null> {
    if (Date.now() < nextAllowedRequestAt) return null;
    const serverKey = getServerKey();
    if (!serverKey) {
        logger.warn('[911 Reliable] No ER:LC server key is available to the running bot process.');
        return null;
    }

    const url = new URL(ERLC_SERVER_ENDPOINT);
    url.searchParams.set('Players', 'true');
    url.searchParams.set('EmergencyCalls', 'true');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', 'server-key': serverKey },
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const resetSeconds = Number(response.headers.get('x-ratelimit-reset') || 0);
        if (response.status === 429) {
            const delay = Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.ceil(retryAfter * 1_000)
                : Number.isFinite(resetSeconds) && resetSeconds > 0
                    ? Math.max(1_000, Math.ceil(resetSeconds * 1_000 - Date.now()))
                    : 15_000;
            nextAllowedRequestAt = Date.now() + delay;
            logger.warn(`[911 Reliable] ER:LC rate limited the 911 scan; retrying after ${Math.ceil(delay / 1_000)}s.`);
            return null;
        }

        if (!response.ok || !isRecord(payload)) {
            const code = isRecord(payload) ? asNumber(payload.code) : null;
            logger.warn(`[911 Reliable] ER:LC 911 scan failed: HTTP ${response.status}${code !== null ? ` / code ${Math.trunc(code)}` : ''}.`);
            return null;
        }

        const rawCalls = Array.isArray(payload.EmergencyCalls) ? payload.EmergencyCalls : [];
        const calls = rawCalls.map(parseCall).filter((call): call is ParsedCall => Boolean(call));
        const players = Array.isArray(payload.Players)
            ? payload.Players.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player))
            : [];

        if (rawCalls.length !== calls.length) {
            logger.warn(`[911 Reliable] ER:LC returned ${rawCalls.length} emergency calls; ${calls.length} were parsed.`);
        }
        return { calls, players };
    } catch (error) {
        logger.warn(`[911 Reliable] ER:LC 911 scan request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function pollReliableEmergencyDispatch(client: Client): Promise<void> {
    if (requestRunning) return;
    requestRunning = true;
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;
        const snapshot = await fetchSnapshot();
        if (!snapshot) return;
        for (const call of snapshot.calls.sort((a, b) => a.startedAt - b.startedAt)) {
            await postCall(client, guildId, call, snapshot.players).catch(error => {
                logger.warn(`[911 Reliable] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
    } finally {
        requestRunning = false;
    }
}

export function startReliableEmergencyDispatchWatcher(client: Client): void {
    if (timer) clearInterval(timer);
    void pollReliableEmergencyDispatch(client);
    timer = setInterval(() => void pollReliableEmergencyDispatch(client), POLL_INTERVAL_MS);
    logger.info('[911 Reliable] Post-first ER:LC emergency-call watcher started.');
}

export function triggerReliableEmergencyDispatchFromWebhook(client: Client, payload?: Record<string, unknown>): void {
    const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
    const directCall = payload ? findCallInWebhook(payload) : null;
    if (guildId && directCall) {
        void postCall(client, guildId, directCall, []).catch(error => {
            logger.warn(`[911 Reliable] Signed webhook call could not be posted directly: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }
    setTimeout(() => void pollReliableEmergencyDispatch(client), 200);
    setTimeout(() => void pollReliableEmergencyDispatch(client), 1_200);
}
