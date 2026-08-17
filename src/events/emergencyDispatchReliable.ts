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

function text(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function unixSeconds(value: unknown): number | null {
    const parsed = numberValue(value);
    if (parsed === null || parsed <= 0) return null;
    return Math.floor(parsed >= 1_000_000_000_000 ? parsed / 1_000 : parsed);
}

function parseIdentity(value: unknown): { username: string; robloxId: string | null } {
    const raw = text(value) || '';
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
    const team = text(value.Team ?? value.team);
    if (!team || identity.username === 'Unknown') return null;

    const rawLocation = isRecord(value.Location) ? value.Location : isRecord(value.location) ? value.location : null;
    let location: ParsedPlayer['location'] = null;
    if (rawLocation) {
        const x = numberValue(rawLocation.LocationX ?? rawLocation.x ?? rawLocation.X);
        const z = numberValue(rawLocation.LocationZ ?? rawLocation.z ?? rawLocation.Z);
        if (x !== null && z !== null) {
            location = {
                x,
                z,
                postalCode: text(rawLocation.PostalCode ?? rawLocation.postal),
                streetName: text(rawLocation.StreetName ?? rawLocation.street),
            };
        }
    }

    return {
        robloxId: identity.robloxId,
        username: identity.username,
        team,
        callsign: text(value.Callsign ?? value.callsign),
        location,
    };
}

function parseCaller(value: unknown): { key: string; robloxId: string; label: string } {
    const numeric = numberValue(value);
    if (numeric !== null && numeric > 0) {
        const id = String(Math.trunc(numeric));
        return { key: `id:${id}`, robloxId: id, label: '' };
    }

    const raw = text(value);
    if (raw) {
        const identity = parseIdentity(raw);
        if (identity.robloxId) return { key: `id:${identity.robloxId}`, robloxId: identity.robloxId, label: identity.username };
        return { key: `system:${raw.toLowerCase()}`, robloxId: 'System', label: raw };
    }
    return { key: 'system', robloxId: 'System', label: 'System' };
}

function fallbackCallNumber(value: UnknownRecord, startedAt: number): number {
    const seed = JSON.stringify([
        text(value.Description ?? value.description ?? value.Message ?? value.message) || '',
        text(value.PositionDescriptor ?? value.positionDescriptor ?? value.Location ?? value.location) || '',
        startedAt,
    ]);
    return 100_000 + (parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 7), 16) % 900_000);
}

function parseCall(value: unknown): ParsedCall | null {
    if (!isRecord(value)) return null;

    const position = Array.isArray(value.Position)
        ? value.Position
        : Array.isArray(value.position)
            ? value.position
            : [];
    const x = numberValue(position[0] ?? value.LocationX ?? value.x ?? value.X) ?? 0;
    const z = numberValue(position[1] ?? value.LocationZ ?? value.z ?? value.Z) ?? 0;
    const startedAt = unixSeconds(value.StartedAt ?? value.startedAt ?? value.Timestamp ?? value.timestamp)
        ?? Math.floor(Date.now() / 1_000);
    const explicitCallNumber = numberValue(value.CallNumber ?? value.callNumber ?? value.Number ?? value.number);
    const caller = parseCaller(value.Caller ?? value.caller ?? value.Player ?? value.player ?? value.User ?? value.user);

    const description = text(value.Description ?? value.description ?? value.Message ?? value.message ?? value.Incident ?? value.incident)
        || '911 emergency call received.';
    const location = text(
        value.PositionDescriptor
        ?? value.positionDescriptor
        ?? value.LocationDescriptor
        ?? value.locationDescriptor
        ?? value.Location
        ?? value.location,
    ) || (x !== 0 || z !== 0 ? `ER:LC coordinates X ${x.toFixed(1)}, Z ${z.toFixed(1)}` : 'Location unavailable.');

    return {
        team: text(value.Team ?? value.team ?? value.Service ?? value.service) || 'Emergency Services',
        callerKey: caller.key,
        callerRobloxId: caller.robloxId,
        callerLabel: caller.label,
        positionX: x,
        positionZ: z,
        startedAt,
        callNumber: explicitCallNumber === null ? fallbackCallNumber(value, startedAt) : Math.trunc(explicitCallNumber),
        description,
        positionDescriptor: location,
    };
}

function findWebhookCall(value: unknown, depth = 0): ParsedCall | null {
    if (depth > 5 || !isRecord(value)) return null;
    const looksLikeCall = [
        'CallNumber', 'callNumber', 'Position', 'position', 'StartedAt', 'startedAt',
        'PositionDescriptor', 'positionDescriptor', 'Description', 'description',
    ].some(key => key in value);
    if (looksLikeCall) {
        const parsed = parseCall(value);
        if (parsed) return parsed;
    }
    for (const child of Object.values(value)) {
        if (!isRecord(child)) continue;
        const nested = findWebhookCall(child, depth + 1);
        if (nested) return nested;
    }
    return null;
}

function makeId(guildId: string, call: ParsedCall): string {
    return createHash('sha256')
        .update(`${guildId}:${call.callNumber}:${call.startedAt}:${call.callerKey}:${call.description}`)
        .digest('hex')
        .slice(0, 16);
}

function remember(id: string): void {
    seenIds.add(id);
    while (seenIds.size > MAX_SEEN) {
        const oldest = seenIds.values().next().value as string | undefined;
        if (!oldest) break;
        seenIds.delete(oldest);
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
    if (call.includes('police') || call.includes('sheriff') || call.includes('law')) return team.includes('police') || team.includes('sheriff');
    if (call.includes('fire') || call.includes('ems') || call.includes('medical')) return team.includes('fire') || team.includes('ems') || team.includes('medical');
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

    if (includeMap) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(ERLC_POSTAL_MAP_URL).setDescription('ER:LC postal map'),
            ),
        );
    }

    return container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            controlsEnabled
                ? '### 📝 Dispatch Notes\n*No dispatch notes added yet.*'
                : '### 📝 Dispatch Notes\n*Alert is live. Dispatch controls are waiting for persistent storage.*',
        ))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`dispatch3:attach:${record.dispatchId}`).setLabel('Attach Units').setEmoji('🚓').setStyle(ButtonStyle.Success).setDisabled(!controlsEnabled),
            new ButtonBuilder().setCustomId(`dispatch3:notes:${record.dispatchId}`).setLabel('Add Notes').setEmoji('📝').setStyle(ButtonStyle.Secondary).setDisabled(!controlsEnabled),
            new ButtonBuilder().setCustomId(`dispatch3:end:${record.dispatchId}`).setLabel('End Call').setEmoji('✅').setStyle(ButtonStyle.Danger).setDisabled(!controlsEnabled),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `*Los Angeles Roleplay • 911 Emergency Dispatch • Call #${record.callNumber}*`,
        ));
}

async function callerName(call: ParsedCall, players: ParsedPlayer[]): Promise<string> {
    if (!/^\d+$/.test(call.callerRobloxId)) return call.callerLabel || 'System';
    const inGame = players.find(player => player.robloxId === call.callerRobloxId)?.username;
    if (inGame) return inGame;
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
        return isRecord(body) && text(body.name) ? text(body.name)! : `Roblox User ${call.callerRobloxId}`;
    } catch {
        return `Roblox User ${call.callerRobloxId}`;
    } finally {
        clearTimeout(timeout);
    }
}

function makeRecord(guildId: string, dispatchId: string, call: ParsedCall, players: ParsedPlayer[], name: string): EmergencyDispatchCallRecord {
    const now = new Date();
    return {
        dispatchId,
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

async function persistPostedCall(record: EmergencyDispatchCallRecord, messageId: string, channelId: string): Promise<EmergencyDispatchCallRecord | null> {
    if (!isDatabaseAvailable()) return null;
    try {
        const existing = await EmergencyDispatchCall.findOne({
            guildId: record.guildId,
            callNumber: record.callNumber,
            startedAt: record.startedAt,
        }).lean().exec();

        if (existing) {
            const updated = await EmergencyDispatchCall.findOneAndUpdate(
                { dispatchId: existing.dispatchId },
                { $set: { messageId, channelId, updatedAt: new Date() } },
                { new: true },
            ).lean().exec();
            return updated as unknown as EmergencyDispatchCallRecord | null;
        }

        const created = await EmergencyDispatchCall.create({
            ...record,
            messageId,
            channelId,
            updatedAt: new Date(),
        });
        return created.toObject() as EmergencyDispatchCallRecord;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) {
            const duplicate = await EmergencyDispatchCall.findOneAndUpdate(
                { guildId: record.guildId, callNumber: record.callNumber, startedAt: record.startedAt },
                { $set: { messageId, channelId, updatedAt: new Date() } },
                { new: true },
            ).lean().exec().catch(() => null);
            return duplicate as unknown as EmergencyDispatchCallRecord | null;
        }
        logger.warn(`[911 Reliable] Persistence failed after alert post: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
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

async function postCall(client: Client, guildId: string, call: ParsedCall, players: ParsedPlayer[]): Promise<void> {
    const provisionalId = makeId(guildId, call);
    if (seenIds.has(provisionalId)) return;

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Reliable] Cannot send to ${EMERGENCY_CALL_CHANNEL_ID}; check the bot's channel permissions.`);
        return;
    }

    let record = makeRecord(guildId, provisionalId, call, players, await callerName(call, players));

    // Emergency alert first. A DB failure or map failure can no longer prevent the call from appearing.
    const message = await channel.send({
        components: [panel(record, false, false)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    remember(provisionalId);

    const persisted = await persistPostedCall(record, message.id, message.channelId);
    const controlsEnabled = Boolean(persisted);
    if (persisted) {
        record = persisted;
        remember(record.dispatchId);
    }

    const includeMap = await mapIsReachable();
    if (controlsEnabled || includeMap) {
        await message.edit({
            components: [panel(record, controlsEnabled, includeMap)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(error => {
            logger.warn(`[911 Reliable] Alert posted but enhancement failed for call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }

    logger.info(`[911 Reliable] Posted ER:LC 911 call #${call.callNumber} in ${EMERGENCY_CALL_CHANNEL_ID}.`);
}

function serverKey(): string {
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
    const key = serverKey();
    if (!key) {
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
            headers: { Accept: 'application/json', 'server-key': key },
            signal: controller.signal,
        });
        const body = await response.json().catch(() => null);

        if (response.status === 429) {
            const retrySeconds = numberValue(response.headers.get('retry-after'));
            const reset = numberValue(response.headers.get('x-ratelimit-reset'));
            const waitMs = retrySeconds !== null && retrySeconds > 0
                ? Math.ceil(retrySeconds * 1_000)
                : reset !== null && reset > 0
                    ? Math.max(1_000, Math.ceil(reset * 1_000 - Date.now()))
                    : 15_000;
            nextAllowedRequestAt = Date.now() + waitMs;
            logger.warn(`[911 Reliable] ER:LC rate limited the scan; retrying in ${Math.ceil(waitMs / 1_000)} seconds.`);
            return null;
        }

        if (!response.ok || !isRecord(body)) {
            const code = isRecord(body) ? numberValue(body.code) : null;
            logger.warn(`[911 Reliable] ER:LC scan failed: HTTP ${response.status}${code !== null ? ` / API code ${Math.trunc(code)}` : ''}.`);
            return null;
        }

        const rawCalls = Array.isArray(body.EmergencyCalls) ? body.EmergencyCalls : [];
        const calls = rawCalls.map(parseCall).filter((call): call is ParsedCall => Boolean(call));
        const players = Array.isArray(body.Players)
            ? body.Players.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player))
            : [];

        logger.info(`[911 Reliable] ER:LC scan returned ${rawCalls.length} emergency call(s); ${calls.length} parsed.`);
        return { calls, players };
    } catch (error) {
        logger.warn(`[911 Reliable] ER:LC request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const directCall = payload ? findWebhookCall(payload) : null;
    if (guildId && directCall) {
        void postCall(client, guildId, directCall, []).catch(error => {
            logger.warn(`[911 Reliable] Signed webhook call could not be posted directly: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }
    setTimeout(() => void pollReliableEmergencyDispatch(client), 200);
    setTimeout(() => void pollReliableEmergencyDispatch(client), 1_200);
}
