import { createHash } from 'node:crypto';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    UserSelectMenuInteraction,
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
const DISPATCH_ROLE_ID = '1530984749232033963';
const PANEL_COLOR = 0x247bf1;
const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 9_000;
const MAX_SEEN = 500;

let timer: ReturnType<typeof setInterval> | null = null;
let requestRunning = false;
let nextAllowedRequestAt = 0;
const seenIds = new Set<string>();
const liveCalls = new Map<string, EmergencyDispatchCallRecord>();

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

    const rawLocation = isRecord(value.Location)
        ? value.Location
        : isRecord(value.location)
            ? value.location
            : null;
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
        if (identity.robloxId) {
            return { key: `id:${identity.robloxId}`, robloxId: identity.robloxId, label: identity.username };
        }
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
    ) || (x !== 0 || z !== 0
        ? `ER:LC coordinates X ${x.toFixed(1)}, Z ${z.toFixed(1)}`
        : 'Location unavailable.');

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

function makeId(guildId: string, call: ParsedCall): string {
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

function closestText(record: EmergencyDispatchCallRecord): string {
    if (!record.closestUnits.length) return '*No nearby matching units were available in the current player snapshot.*';
    return record.closestUnits.map((unit, index) => {
        const callsign = unit.callsign ? `**${clean(unit.callsign, 40)}** • ` : '';
        const location = [
            unit.streetName,
            unit.postalCode ? `Postal ${unit.postalCode}` : null,
        ].filter(Boolean).join(' • ');
        return `**${index + 1}.** ${callsign}${clean(unit.robloxUsername, 80)}${location ? ` — ${clean(location, 120)}` : ''}`;
    }).join('\n');
}

function assignedText(record: EmergencyDispatchCallRecord): string {
    return record.assignedDiscordIds.length
        ? record.assignedDiscordIds.map(id => `<@${id}>`).join(' • ')
        : '*No units assigned yet.*';
}

function notesText(record: EmergencyDispatchCallRecord): string {
    if (!record.notes.length) return '*No dispatch notes added yet.*';
    return record.notes.slice(-5).map(note => {
        const unix = Math.floor(new Date(note.createdAt).getTime() / 1_000);
        return `• <@${note.authorId}> • <t:${unix}:R> — ${clean(note.text, 450)}`;
    }).join('\n');
}

function buildPanel(record: EmergencyDispatchCallRecord): ContainerBuilder {
    const ended = record.status === 'Ended';
    const callerId = /^\d+$/.test(record.callerRobloxId)
        ? ` • Roblox ID \`${record.callerRobloxId}\``
        : '';

    return new ContainerBuilder()
        .setAccentColor(ended ? 0x6b7280 : PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            ended
                ? `## ✅ 911 Call Closed: ${serviceLabel(record.team)}`
                : `## 📞 911 Call Received: ${serviceLabel(record.team)}`,
            `**Caller:** ${clean(record.callerRobloxUsername, 90)}${callerId}`,
            `**Incident:** ${clean(record.description, 1_000)}`,
            `**Location:** ${clean(record.positionDescriptor, 500)}`,
            `**Call Number:** \`${record.callNumber}\``,
            `**Time:** <t:${record.startedAt}:F> • <t:${record.startedAt}:R>`,
            `**Status:** ${ended ? '🔴 **Ended — responding units are 10-8**' : '🟢 **Active**'}`,
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🚔 Closest Units',
            closestText(record),
            '',
            '### 👥 Assigned Units',
            assignedText(record),
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🗺️ ER:LC Call Location',
            `📍 **X:** \`${record.positionX.toFixed(1)}\` • **Z:** \`${record.positionZ.toFixed(1)}\``,
            `**Location:** ${clean(record.positionDescriptor, 500)}`,
            '*Map below is the current ER:LC postal map.*',
        ].join('\n')))
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(ERLC_POSTAL_MAP_URL)
                    .setDescription(`ER:LC postal map — call #${record.callNumber}`),
            ),
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 📝 Dispatch Notes',
            notesText(record),
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`dispatchpro:attach:${record.dispatchId}`)
                .setLabel('Attach Units')
                .setEmoji('🚓')
                .setStyle(ButtonStyle.Success)
                .setDisabled(ended),
            new ButtonBuilder()
                .setCustomId(`dispatchpro:notes:${record.dispatchId}`)
                .setLabel('Add Notes')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(ended),
            new ButtonBuilder()
                .setCustomId(`dispatchpro:end:${record.dispatchId}`)
                .setLabel('End Call')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(ended),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `*Los Angeles Roleplay • 911 Emergency Dispatch • Call #${record.callNumber}*`,
        ));
}

async function resolveCallerName(call: ParsedCall, players: ParsedPlayer[]): Promise<string> {
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
        return isRecord(body) && text(body.name)
            ? text(body.name)!
            : `Roblox User ${call.callerRobloxId}`;
    } catch {
        return `Roblox User ${call.callerRobloxId}`;
    } finally {
        clearTimeout(timeout);
    }
}

function makeRecord(
    guildId: string,
    dispatchId: string,
    call: ParsedCall,
    players: ParsedPlayer[],
    username: string,
): EmergencyDispatchCallRecord {
    const now = new Date();
    return {
        dispatchId,
        guildId,
        callNumber: call.callNumber,
        startedAt: call.startedAt,
        team: call.team,
        callerRobloxId: call.callerRobloxId,
        callerRobloxUsername: username,
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

async function loadRecord(dispatchId: string): Promise<EmergencyDispatchCallRecord | null> {
    const live = liveCalls.get(dispatchId);
    if (live) return live;
    if (!isDatabaseAvailable()) return null;
    const stored = await EmergencyDispatchCall.findOne({ dispatchId }).lean().exec().catch(() => null);
    if (!stored) return null;
    const record = stored as unknown as EmergencyDispatchCallRecord;
    liveCalls.set(record.dispatchId, record);
    return record;
}

async function persistRecord(record: EmergencyDispatchCallRecord): Promise<void> {
    record.updatedAt = new Date();
    liveCalls.set(record.dispatchId, record);
    if (!isDatabaseAvailable()) return;
    await EmergencyDispatchCall.findOneAndUpdate(
        { guildId: record.guildId, callNumber: record.callNumber, startedAt: record.startedAt },
        { $set: record },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec().catch(error => {
        logger.warn(`[911 Pro] Could not persist call #${record.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function editCallMessage(client: Client, record: EmergencyDispatchCallRecord): Promise<void> {
    if (!record.channelId || !record.messageId) return;
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [buildPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function postCall(client: Client, guildId: string, call: ParsedCall, players: ParsedPlayer[]): Promise<void> {
    const dispatchId = makeId(guildId, call);
    if (seenIds.has(dispatchId)) return;

    if (isDatabaseAvailable()) {
        const existing = await EmergencyDispatchCall.findOne({
            guildId,
            callNumber: call.callNumber,
            startedAt: call.startedAt,
        }).lean().exec().catch(() => null);
        if (existing?.messageId) {
            const existingRecord = existing as unknown as EmergencyDispatchCallRecord;
            liveCalls.set(existingRecord.dispatchId, existingRecord);
            remember(dispatchId);
            remember(existingRecord.dispatchId);
            return;
        }
    }

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Pro] Cannot send to ${EMERGENCY_CALL_CHANNEL_ID}.`);
        return;
    }

    const record = makeRecord(
        guildId,
        dispatchId,
        call,
        players,
        await resolveCallerName(call, players),
    );
    liveCalls.set(dispatchId, record);

    const message = await channel.send({
        components: [buildPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });

    record.channelId = message.channelId;
    record.messageId = message.id;
    liveCalls.set(dispatchId, record);
    remember(dispatchId);
    await persistRecord(record);
    logger.info(`[911 Pro] Posted call #${record.callNumber}; controls and ER:LC map are active.`);
}

function serverKey(): string {
    return (process.env.ERLC_SERVER_KEY || '').trim();
}

async function fetchSnapshot(): Promise<{ calls: ParsedCall[]; players: ParsedPlayer[] } | null> {
    if (Date.now() < nextAllowedRequestAt) return null;
    const key = serverKey();
    if (!key) {
        logger.warn('[911 Pro] ERLC_SERVER_KEY is not available to the running bot.');
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
            nextAllowedRequestAt = Date.now() + (retrySeconds !== null && retrySeconds > 0
                ? Math.ceil(retrySeconds * 1_000)
                : 15_000);
            return null;
        }
        if (!response.ok || !isRecord(body)) {
            logger.warn(`[911 Pro] ER:LC scan failed with HTTP ${response.status}.`);
            return null;
        }

        const rawCalls = Array.isArray(body.EmergencyCalls) ? body.EmergencyCalls : [];
        const calls = rawCalls.map(parseCall).filter((call): call is ParsedCall => Boolean(call));
        const players = Array.isArray(body.Players)
            ? body.Players.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player))
            : [];
        return { calls, players };
    } catch (error) {
        logger.warn(`[911 Pro] ER:LC request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function poll(client: Client): Promise<void> {
    if (requestRunning) return;
    requestRunning = true;
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;
        const snapshot = await fetchSnapshot();
        if (!snapshot) return;
        for (const call of snapshot.calls.sort((a, b) => a.startedAt - b.startedAt)) {
            await postCall(client, guildId, call, snapshot.players).catch(error => {
                logger.warn(`[911 Pro] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
    } finally {
        requestRunning = false;
    }
}

export function startEmergencyDispatchProWatcher(client: Client): void {
    if (timer) clearInterval(timer);
    void poll(client);
    timer = setInterval(() => void poll(client), POLL_INTERVAL_MS);
    logger.info('[911 Pro] Emergency-call watcher online; Attach Units and map enabled.');
}

async function hasDispatchRole(
    interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction,
): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(DISPATCH_ROLE_ID)) return true;
    if (member && Array.isArray(member.roles) && member.roles.includes(DISPATCH_ROLE_ID)) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(DISPATCH_ROLE_ID));
}

function notesModal(dispatchId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`dispatchpro:notes-modal:${dispatchId}`)
        .setTitle('Add Dispatch Notes')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('notes')
                .setLabel('Dispatch notes')
                .setPlaceholder('Enter information responding units should know.')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(1_000),
        ));
}

export async function handleEmergencyDispatchProButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatchpro:(attach|notes|end):([a-f0-9]{16})$/);
    if (!match) return false;

    if (!await hasDispatchRole(interaction)) {
        await interaction.reply({
            content: `You need <@&${DISPATCH_ROLE_ID}> to manage 911 calls.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const record = await loadRecord(match[2]);
    if (!record || record.status !== 'Active') {
        await interaction.reply({ content: 'That 911 call is no longer active.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (match[1] === 'attach') {
        const selector = new UserSelectMenuBuilder()
            .setCustomId(`dispatchpro:attach-select:${record.dispatchId}`)
            .setPlaceholder('Select responding unit(s)')
            .setMinValues(1)
            .setMaxValues(10);
        await interaction.reply({
            content: `🚓 Select the Discord unit(s) responding to call #${record.callNumber}.`,
            components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selector)],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (match[1] === 'notes') {
        await interaction.showModal(notesModal(record.dispatchId));
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    record.status = 'Ended';
    record.endedAt = new Date();
    record.endedById = interaction.user.id;
    await persistRecord(record);
    await editCallMessage(interaction.client, record).catch(() => undefined);
    await interaction.editReply(`✅ Call #${record.callNumber} ended. Assigned units are now 10-8.`);
    return true;
}

export async function handleEmergencyDispatchProUserSelect(
    interaction: UserSelectMenuInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatchpro:attach-select:([a-f0-9]{16})$/);
    if (!match) return false;

    if (!await hasDispatchRole(interaction)) {
        await interaction.update({
            content: `You need <@&${DISPATCH_ROLE_ID}> to attach units.`,
            components: [],
        });
        return true;
    }

    const record = await loadRecord(match[1]);
    if (!record || record.status !== 'Active') {
        await interaction.update({ content: 'That 911 call is no longer active.', components: [] });
        return true;
    }

    const selectedIds = [...interaction.users.values()]
        .filter(user => !user.bot)
        .map(user => user.id);
    record.assignedDiscordIds = Array.from(new Set([
        ...record.assignedDiscordIds,
        ...selectedIds,
    ]));

    await persistRecord(record);
    await editCallMessage(interaction.client, record).catch(() => undefined);
    await interaction.update({
        content: `✅ ${selectedIds.length} unit${selectedIds.length === 1 ? '' : 's'} attached to call #${record.callNumber}.`,
        components: [],
    });
    return true;
}

export async function handleEmergencyDispatchProModal(
    interaction: ModalSubmitInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatchpro:notes-modal:([a-f0-9]{16})$/);
    if (!match) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await hasDispatchRole(interaction)) {
        await interaction.editReply(`You need <@&${DISPATCH_ROLE_ID}> to write dispatch notes.`);
        return true;
    }

    const record = await loadRecord(match[1]);
    if (!record || record.status !== 'Active') {
        await interaction.editReply('That 911 call is no longer active.');
        return true;
    }

    record.notes.push({
        authorId: interaction.user.id,
        text: interaction.fields.getTextInputValue('notes').trim(),
        createdAt: new Date(),
    });
    await persistRecord(record);
    await editCallMessage(interaction.client, record).catch(() => undefined);
    await interaction.editReply(`✅ Dispatch notes added to call #${record.callNumber}.`);
    return true;
}
