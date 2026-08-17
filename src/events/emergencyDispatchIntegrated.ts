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

const EMERGENCY_CALL_CHANNEL_ID = '1538695671081861221';
const ERLC_POSTAL_MAP_URL = 'https://api.policeroleplay.community/maps/fall_postals.png';
const PANEL_COLOR = 0x247bf1;
const seenWithoutDatabase = new Set<string>();

type UnknownRecord = Record<string, unknown>;

interface ParsedPlayer {
    robloxId: string | null;
    username: string;
    team: string;
    callsign: string | null;
    location: {
        x: number;
        z: number;
        postalCode: string | null;
        streetName: string | null;
    } | null;
}

interface ParsedCall {
    team: string;
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

function unixSeconds(value: unknown): number {
    const parsed = numberValue(value);
    if (parsed === null || parsed <= 0) return Math.floor(Date.now() / 1_000);
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
    const identity = parseIdentity(value.Player);
    const team = text(value.Team);
    if (!team || identity.username === 'Unknown') return null;

    let location: ParsedPlayer['location'] = null;
    if (isRecord(value.Location)) {
        const x = numberValue(value.Location.LocationX);
        const z = numberValue(value.Location.LocationZ);
        if (x !== null && z !== null) {
            location = {
                x,
                z,
                postalCode: text(value.Location.PostalCode),
                streetName: text(value.Location.StreetName),
            };
        }
    }

    return {
        robloxId: identity.robloxId,
        username: identity.username,
        team,
        callsign: text(value.Callsign),
        location,
    };
}

function parseCall(value: unknown): ParsedCall | null {
    if (!isRecord(value)) return null;
    const position = Array.isArray(value.Position) ? value.Position : [];
    const x = numberValue(position[0]);
    const z = numberValue(position[1]);
    const callNumber = numberValue(value.CallNumber);
    if (x === null || z === null || callNumber === null) return null;

    const rawCaller = value.Caller;
    const numericCaller = numberValue(rawCaller);
    let callerRobloxId = 'System';
    let callerLabel = 'System';
    if (numericCaller !== null && numericCaller > 0) {
        callerRobloxId = String(Math.trunc(numericCaller));
        callerLabel = '';
    } else {
        const identity = parseIdentity(rawCaller);
        if (identity.robloxId) {
            callerRobloxId = identity.robloxId;
            callerLabel = identity.username;
        } else if (identity.username !== 'Unknown') {
            callerLabel = identity.username;
        }
    }

    return {
        team: text(value.Team) || 'Emergency Services',
        callerRobloxId,
        callerLabel,
        positionX: x,
        positionZ: z,
        startedAt: unixSeconds(value.StartedAt),
        callNumber: Math.trunc(callNumber),
        description: text(value.Description) || '911 emergency call received.',
        positionDescriptor: text(value.PositionDescriptor) || `ER:LC coordinates X ${x.toFixed(1)}, Z ${z.toFixed(1)}`,
    };
}

function dispatchId(guildId: string, call: ParsedCall): string {
    return createHash('sha256')
        .update(`${guildId}:${call.callNumber}:${call.startedAt}:${call.callerRobloxId}:${call.description}`)
        .digest('hex')
        .slice(0, 16);
}

function matchingUnit(callTeam: string, playerTeam: string): boolean {
    const call = callTeam.toLowerCase();
    const team = playerTeam.toLowerCase();
    if (call.includes('police') || call.includes('law') || call.includes('sheriff')) {
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

function safe(value: string, max = 1_300): string {
    const clean = value.replace(/@/g, '@\u200b').replace(/```/g, "'''").trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function buildPanel(record: EmergencyDispatchCallRecord): ContainerBuilder {
    const callerId = /^\d+$/.test(record.callerRobloxId) ? ` • Roblox ID \`${record.callerRobloxId}\`` : '';
    const closest = record.closestUnits.length
        ? record.closestUnits.map((unit, i) => {
            const callsign = unit.callsign ? `**${safe(unit.callsign, 40)}** • ` : '';
            const location = [unit.streetName, unit.postalCode ? `Postal ${unit.postalCode}` : null].filter(Boolean).join(' • ');
            return `**${i + 1}.** ${callsign}${safe(unit.robloxUsername, 80)}${location ? ` — ${safe(location, 120)}` : ''}`;
        }).join('\n')
        : '*No nearby matching units were available in this snapshot.*';

    return new ContainerBuilder()
        .setAccentColor(PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## 📞 911 Call Received: ${safe(record.team, 80)}`,
            `**Caller:** ${safe(record.callerRobloxUsername, 90)}${callerId}`,
            `**Incident:** ${safe(record.description, 1_000)}`,
            `**Location:** ${safe(record.positionDescriptor, 500)}`,
            `**Call Number:** \`${record.callNumber}\``,
            `**Time:** <t:${record.startedAt}:F> • <t:${record.startedAt}:R>`,
            '**Status:** 🟢 **Active**',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🚔 Closest Units',
            closest,
            '',
            '### 👥 Assigned Units',
            '*No units assigned yet.*',
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🗺️ ER:LC Call Location',
            `📍 **X:** \`${record.positionX.toFixed(1)}\` • **Z:** \`${record.positionZ.toFixed(1)}\``,
            `**Location:** ${safe(record.positionDescriptor, 500)}`,
        ].join('\n')))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
                .setURL(ERLC_POSTAL_MAP_URL)
                .setDescription(`ER:LC postal map — call #${record.callNumber}`),
        ))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### 📝 Dispatch Notes\n*No dispatch notes added yet.*'))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`dispatchpro:attach:${record.dispatchId}`).setLabel('Attach Units').setEmoji('🚓').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`dispatchpro:notes:${record.dispatchId}`).setLabel('Add Notes').setEmoji('📝').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`dispatchpro:end:${record.dispatchId}`).setLabel('End Call').setEmoji('✅').setStyle(ButtonStyle.Danger),
        ));
}

async function resolveCallerName(call: ParsedCall, players: ParsedPlayer[]): Promise<string> {
    if (!/^\d+$/.test(call.callerRobloxId)) return call.callerLabel || 'System';
    const inGame = players.find(player => player.robloxId === call.callerRobloxId)?.username;
    if (inGame) return inGame;
    if (call.callerLabel) return call.callerLabel;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
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
        clearTimeout(timer);
    }
}

async function postCall(client: Client, guildId: string, call: ParsedCall, players: ParsedPlayer[]): Promise<void> {
    const id = dispatchId(guildId, call);

    if (isDatabaseAvailable()) {
        const existing = await EmergencyDispatchCall.findOne({
            guildId,
            callNumber: call.callNumber,
            startedAt: call.startedAt,
        }).lean().exec().catch(() => null);
        if (existing?.messageId) return;
    } else if (seenWithoutDatabase.has(id)) {
        return;
    }

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Integrated] Cannot send to ${EMERGENCY_CALL_CHANNEL_ID}.`);
        return;
    }

    const now = new Date();
    const record: EmergencyDispatchCallRecord = {
        dispatchId: id,
        guildId,
        callNumber: call.callNumber,
        startedAt: call.startedAt,
        team: call.team,
        callerRobloxId: call.callerRobloxId,
        callerRobloxUsername: await resolveCallerName(call, players),
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

    // Store before posting so the dispatchpro buttons can resolve this call immediately.
    if (isDatabaseAvailable()) {
        await EmergencyDispatchCall.findOneAndUpdate(
            { guildId, callNumber: call.callNumber, startedAt: call.startedAt },
            { $setOnInsert: record },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec();
    } else {
        seenWithoutDatabase.add(id);
    }

    const message = await channel.send({
        components: [buildPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });

    record.messageId = message.id;
    record.channelId = message.channelId;
    if (isDatabaseAvailable()) {
        await EmergencyDispatchCall.updateOne(
            { guildId, callNumber: call.callNumber, startedAt: call.startedAt },
            { $set: { messageId: message.id, channelId: message.channelId, updatedAt: new Date() } },
        ).exec();
    }

    logger.info(`[911 Integrated] Posted ${/^\d+$/.test(call.callerRobloxId) ? 'PLAYER' : 'SYSTEM'} call #${call.callNumber} from ${record.callerRobloxUsername}.`);
}

/** Consume EmergencyCalls from the same v2 response used by the main ER:LC monitor. */
export async function processIntegratedEmergencyCalls(client: Client, payload: unknown): Promise<void> {
    if (!isRecord(payload)) return;
    const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
    if (!guildId) return;

    const rawCalls = Array.isArray(payload.EmergencyCalls) ? payload.EmergencyCalls : [];
    const calls = rawCalls.map(parseCall).filter((call): call is ParsedCall => Boolean(call));
    const players = Array.isArray(payload.Players)
        ? payload.Players.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player))
        : [];

    const playerCalls = calls.filter(call => /^\d+$/.test(call.callerRobloxId)).length;
    const systemCalls = calls.length - playerCalls;
    logger.info(`[911 Integrated] Snapshot has ${calls.length} call(s): ${playerCalls} player, ${systemCalls} system.`);

    for (const call of calls.sort((a, b) => a.startedAt - b.startedAt)) {
        await postCall(client, guildId, call, players).catch(error => {
            logger.warn(`[911 Integrated] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }
}
