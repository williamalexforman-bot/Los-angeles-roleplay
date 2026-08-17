import { createHash } from 'node:crypto';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
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
    SlashCommandBuilder,
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
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PANEL_COLOR = 0x247bf1;

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let pollRunning = false;
let lastDiagnostic: DispatchDiagnostic = {
    checkedAt: 0,
    httpStatus: null,
    apiCode: null,
    activeCallCount: null,
    parsedCallCount: null,
    playerCount: null,
    message: 'No scan has run yet.',
};

type UnknownRecord = Record<string, unknown>;

interface ParsedPlayer {
    robloxId: string | null;
    username: string;
    team: string;
    callsign: string | null;
    location: { x: number; z: number; postalCode: string | null; streetName: string | null } | null;
}

interface ParsedEmergencyCall {
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

interface DispatchSnapshot {
    calls: ParsedEmergencyCall[];
    players: ParsedPlayer[];
    rawCallCount: number;
}

interface DispatchDiagnostic {
    checkedAt: number;
    httpStatus: number | null;
    apiCode: number | null;
    activeCallCount: number | null;
    parsedCallCount: number | null;
    playerCount: number | null;
    message: string;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function timestampSeconds(value: unknown): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return Math.floor(parsed >= 1_000_000_000_000 ? parsed / 1_000 : parsed);
}

function parseIdentity(value: unknown): { username: string; robloxId: string | null } {
    const raw = text(value) || '';
    const separator = raw.lastIndexOf(':');
    if (separator > 0 && separator < raw.length - 1) {
        const username = raw.slice(0, separator).trim();
        const possibleId = raw.slice(separator + 1).trim();
        if (username && /^\d+$/.test(possibleId)) return { username, robloxId: possibleId };
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
        const x = finiteNumber(value.Location.LocationX);
        const z = finiteNumber(value.Location.LocationZ);
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

function parseCaller(value: unknown): { key: string; robloxId: string; label: string } {
    const numeric = finiteNumber(value);
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

function parseEmergencyCall(value: unknown): ParsedEmergencyCall | null {
    if (!isRecord(value)) return null;
    const startedAt = timestampSeconds(value.StartedAt);
    const callNumber = finiteNumber(value.CallNumber);
    const position = Array.isArray(value.Position) ? value.Position : [];
    const x = finiteNumber(position[0]);
    const z = finiteNumber(position[1]);
    if (startedAt === null || callNumber === null || x === null || z === null) return null;

    const caller = parseCaller(value.Caller);
    return {
        team: text(value.Team) || 'Emergency Services',
        callerKey: caller.key,
        callerRobloxId: caller.robloxId,
        callerLabel: caller.label,
        positionX: x,
        positionZ: z,
        startedAt,
        callNumber: Math.trunc(callNumber),
        description: text(value.Description) || 'No additional information was provided.',
        positionDescriptor: text(value.PositionDescriptor) || 'Location description unavailable.',
    };
}

function safe(value: string, max = 1_500): string {
    const cleaned = value.replace(/```/g, "'''").replace(/@/g, '@\u200b').trim();
    if (!cleaned) return 'Unavailable';
    return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function makeDispatchId(guildId: string, call: ParsedEmergencyCall): string {
    return createHash('sha256')
        .update(`${guildId}:${call.callNumber}:${call.startedAt}:${call.callerKey}`)
        .digest('hex')
        .slice(0, 16);
}

function serviceLabel(team: string): string {
    const value = team.toLowerCase();
    if (value.includes('police') || value.includes('sheriff') || value.includes('law')) return 'Law Enforcement';
    if (value.includes('fire') || value.includes('ems') || value.includes('medical')) return 'Fire & Rescue';
    return team || 'Emergency Services';
}

function matchesCallTeam(callTeam: string, playerTeam: string): boolean {
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

function calculateClosestUnits(call: ParsedEmergencyCall, players: ParsedPlayer[]): EmergencyDispatchClosestUnit[] {
    return players
        .filter(player => player.location && matchesCallTeam(call.team, player.team))
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

async function resolveCallerUsername(call: ParsedEmergencyCall, players: ParsedPlayer[]): Promise<string> {
    if (!/^\d+$/.test(call.callerRobloxId)) return call.callerLabel || 'System';
    const inGame = players.find(player => player.robloxId === call.callerRobloxId)?.username;
    if (inGame) return inGame;
    if (call.callerLabel) return call.callerLabel;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
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

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function mapGallery(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(ERLC_POSTAL_MAP_URL));
}

function closestUnitsBlock(record: EmergencyDispatchCallRecord): string {
    if (!record.closestUnits.length) return '*No nearby matching emergency units were available in the latest snapshot.*';
    return record.closestUnits.map((unit, index) => {
        const callsign = unit.callsign ? `**${safe(unit.callsign, 40)}** • ` : '';
        const location = [unit.streetName, unit.postalCode ? `Postal ${unit.postalCode}` : null].filter(Boolean).join(' • ');
        return `**${index + 1}.** ${callsign}${safe(unit.robloxUsername, 80)}${location ? ` — ${safe(location, 150)}` : ''} • ~${Math.round(unit.distance)} studs`;
    }).join('\n');
}

function assignedUnitsBlock(record: EmergencyDispatchCallRecord): string {
    return record.assignedDiscordIds.length
        ? record.assignedDiscordIds.map(id => `<@${id}>`).join(' • ')
        : '*No units assigned yet.*';
}

function notesBlock(record: EmergencyDispatchCallRecord): string {
    if (!record.notes.length) return '*No dispatch notes added yet.*';
    return record.notes.slice(-5).map(note => {
        const unix = Math.floor(new Date(note.createdAt).getTime() / 1_000);
        return `• <@${note.authorId}> • <t:${unix}:R> — ${safe(note.text, 450)}`;
    }).join('\n');
}

function buildDispatchPanel(record: EmergencyDispatchCallRecord): ContainerBuilder {
    const ended = record.status === 'Ended';
    const callerId = /^\d+$/.test(record.callerRobloxId) ? ` • Roblox ID \`${record.callerRobloxId}\`` : '';
    const status = ended
        ? `🔴 **Ended**${record.endedById ? ` by <@${record.endedById}>` : ''} • Assigned units are 10-8.`
        : '🟢 **Active**';

    return new ContainerBuilder()
        .setAccentColor(ended ? 0x6b7280 : PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            ended ? `## ✅ 911 Call Closed: ${serviceLabel(record.team)}` : `## 📞 911 Call Received: ${serviceLabel(record.team)}`,
            `**Caller:** ${safe(record.callerRobloxUsername, 80)}${callerId}`,
            `**Incident:** ${safe(record.description, 1_000)}`,
            `**Location:** ${safe(record.positionDescriptor, 500)}`,
            `**Call Number:** \`${record.callNumber}\``,
            `**Time:** <t:${record.startedAt}:F> • <t:${record.startedAt}:R>`,
            `**Status:** ${status}`,
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🚔 Closest Units',
            closestUnitsBlock(record),
            '',
            '### 👥 Assigned Units',
            assignedUnitsBlock(record),
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🗺️ ER:LC Call Location',
            `📍 **X:** \`${record.positionX.toFixed(1)}\` • **Z:** \`${record.positionZ.toFixed(1)}\``,
            `**Location:** ${safe(record.positionDescriptor, 500)}`,
        ].join('\n')))
        .addMediaGalleryComponents(mapGallery())
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(['### 📝 Dispatch Notes', notesBlock(record)].join('\n')))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`dispatch3:attach:${record.dispatchId}`).setLabel('Attach Units').setEmoji('🚓').setStyle(ButtonStyle.Success).setDisabled(ended),
                new ButtonBuilder().setCustomId(`dispatch3:notes:${record.dispatchId}`).setLabel('Add Notes').setEmoji('📝').setStyle(ButtonStyle.Secondary).setDisabled(ended),
                new ButtonBuilder().setCustomId(`dispatch3:end:${record.dispatchId}`).setLabel('End Call').setEmoji('✅').setStyle(ButtonStyle.Danger).setDisabled(ended),
            ),
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`*Los Angeles Roleplay • 911 Emergency Dispatch • Call #${record.callNumber}*`));
}

async function hasDispatchRole(interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction | ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(DISPATCH_ROLE_ID)) return true;
    if (member && Array.isArray(member.roles) && member.roles.includes(DISPATCH_ROLE_ID)) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(DISPATCH_ROLE_ID));
}

async function editCallMessage(client: Client, record: EmergencyDispatchCallRecord): Promise<void> {
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel) || !record.messageId) return;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return;
    await message.edit({ components: [buildDispatchPanel(record)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

function notesModal(id: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`dispatch3:notes-modal:${id}`)
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

async function fetchSnapshot(): Promise<DispatchSnapshot | null> {
    const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
    if (!serverKey) {
        lastDiagnostic = { checkedAt: Date.now(), httpStatus: null, apiCode: null, activeCallCount: null, parsedCallCount: null, playerCount: null, message: 'ERLC_SERVER_KEY is not configured.' };
        return null;
    }

    const url = new URL(ERLC_SERVER_ENDPOINT);
    url.searchParams.set('Players', 'true');
    url.searchParams.set('EmergencyCalls', 'true');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'server-key': serverKey }, signal: controller.signal });
        const payload = await response.json().catch(() => null);
        const apiCode = isRecord(payload) ? finiteNumber(payload.code) : null;
        if (!response.ok || !isRecord(payload)) {
            lastDiagnostic = {
                checkedAt: Date.now(), httpStatus: response.status, apiCode: apiCode === null ? null : Math.trunc(apiCode),
                activeCallCount: null, parsedCallCount: null, playerCount: null,
                message: `ER:LC request failed with HTTP ${response.status}${apiCode !== null ? ` / API code ${Math.trunc(apiCode)}` : ''}.`,
            };
            logger.warn(`[911 Dispatch V3] ${lastDiagnostic.message}`);
            return null;
        }

        const rawCalls = Array.isArray(payload.EmergencyCalls) ? payload.EmergencyCalls : [];
        const calls = rawCalls.map(parseEmergencyCall).filter((item): item is ParsedEmergencyCall => Boolean(item));
        const players = Array.isArray(payload.Players)
            ? payload.Players.map(parsePlayer).filter((item): item is ParsedPlayer => Boolean(item))
            : [];
        lastDiagnostic = {
            checkedAt: Date.now(), httpStatus: response.status, apiCode: null,
            activeCallCount: rawCalls.length, parsedCallCount: calls.length, playerCount: players.length,
            message: rawCalls.length === calls.length
                ? `ER:LC returned ${calls.length} active emergency call${calls.length === 1 ? '' : 's'}.`
                : `ER:LC returned ${rawCalls.length} emergency calls; ${calls.length} could be parsed.`,
        };
        return { calls, players, rawCallCount: rawCalls.length };
    } catch (error) {
        lastDiagnostic = {
            checkedAt: Date.now(), httpStatus: null, apiCode: null, activeCallCount: null, parsedCallCount: null, playerCount: null,
            message: `ER:LC request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        logger.warn(`[911 Dispatch V3] ${lastDiagnostic.message}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function postCall(client: Client, guildId: string, call: ParsedEmergencyCall, players: ParsedPlayer[]): Promise<void> {
    const id = makeDispatchId(guildId, call);
    const existing = await EmergencyDispatchCall.findOne({ dispatchId: id }).lean().exec().catch(() => null);
    if (existing?.messageId) return;

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Dispatch V3] Channel ${EMERGENCY_CALL_CHANNEL_ID} is unavailable.`);
        return;
    }

    let record: EmergencyDispatchCallRecord;
    if (existing) {
        record = existing as unknown as EmergencyDispatchCallRecord;
    } else {
        const callerRobloxUsername = await resolveCallerUsername(call, players);
        try {
            const created = await EmergencyDispatchCall.create({
                dispatchId: id,
                guildId,
                callNumber: call.callNumber,
                startedAt: call.startedAt,
                team: call.team,
                callerRobloxId: call.callerRobloxId,
                callerRobloxUsername,
                description: call.description,
                positionDescriptor: call.positionDescriptor,
                positionX: call.positionX,
                positionZ: call.positionZ,
                closestUnits: calculateClosestUnits(call, players),
                assignedDiscordIds: [],
                notes: [],
                status: 'Active',
                channelId: EMERGENCY_CALL_CHANNEL_ID,
                messageId: '',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            record = created.toObject() as EmergencyDispatchCallRecord;
        } catch (error) {
            if ((error as { code?: number }).code === 11000) {
                const duplicate = await EmergencyDispatchCall.findOne({ guildId, callNumber: call.callNumber, startedAt: call.startedAt }).lean().exec().catch(() => null);
                if (!duplicate || duplicate.messageId) return;
                record = duplicate as unknown as EmergencyDispatchCallRecord;
            } else {
                throw error;
            }
        }
    }

    const message = await channel.send({ components: [buildDispatchPanel(record)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    await EmergencyDispatchCall.updateOne({ dispatchId: record.dispatchId }, { $set: { messageId: message.id, channelId: message.channelId, updatedAt: new Date() } }).exec();
    logger.info(`[911 Dispatch V3] Posted call #${record.callNumber} from ${record.callerRobloxUsername}.`);
}

export async function pollEmergencyDispatchV3(client: Client): Promise<DispatchDiagnostic> {
    if (pollRunning) return lastDiagnostic;
    if (!isDatabaseAvailable()) {
        lastDiagnostic = { checkedAt: Date.now(), httpStatus: null, apiCode: null, activeCallCount: null, parsedCallCount: null, playerCount: null, message: 'MongoDB is unavailable; 911 calls cannot be stored.' };
        return lastDiagnostic;
    }
    pollRunning = true;
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) {
            lastDiagnostic = { checkedAt: Date.now(), httpStatus: null, apiCode: null, activeCallCount: null, parsedCallCount: null, playerCount: null, message: 'No Discord guild is available.' };
            return lastDiagnostic;
        }
        const snapshot = await fetchSnapshot();
        if (!snapshot) return lastDiagnostic;
        for (const call of snapshot.calls.sort((a, b) => a.startedAt - b.startedAt)) {
            await postCall(client, guildId, call, snapshot.players).catch(error => logger.warn(`[911 Dispatch V3] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
        return lastDiagnostic;
    } finally {
        pollRunning = false;
    }
}

export function startEmergencyDispatchV3Watcher(client: Client): void {
    if (watcherTimer) clearInterval(watcherTimer);
    const requested = Number(process.env.ERLC_911_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
    const interval = Number.isFinite(requested) ? Math.max(MIN_POLL_INTERVAL_MS, Math.floor(requested)) : DEFAULT_POLL_INTERVAL_MS;
    void pollEmergencyDispatchV3(client);
    watcherTimer = setInterval(() => void pollEmergencyDispatchV3(client), interval);
    logger.info(`[911 Dispatch V3] Watcher active every ${Math.round(interval / 1_000)} seconds.`);
}

export function triggerEmergencyDispatchFromWebhook(client: Client): void {
    setTimeout(() => void pollEmergencyDispatchV3(client), 250);
    setTimeout(() => void pollEmergencyDispatchV3(client), 1_500);
}

export async function handleEmergencyDispatchV3Button(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch3:(attach|notes|end):([a-f0-9]{16})$/);
    if (!match) return false;
    if (!await hasDispatchRole(interaction)) {
        await interaction.reply({ content: `You need <@&${DISPATCH_ROLE_ID}> to manage 911 dispatch calls.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    const current = await EmergencyDispatchCall.findOne({ dispatchId: match[2] }).lean().exec().catch(() => null);
    if (!current || current.status !== 'Active') {
        await interaction.reply({ content: 'That 911 call is no longer active.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (match[1] === 'notes') {
        await interaction.showModal(notesModal(match[2]));
        return true;
    }
    if (match[1] === 'attach') {
        const selector = new UserSelectMenuBuilder().setCustomId(`dispatch3:attach-select:${match[2]}`).setPlaceholder('Select responding units').setMinValues(1).setMaxValues(10);
        await interaction.reply({ content: `🚓 Select the Discord member(s) to assign to 911 call #${current.callNumber}.`, components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selector)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ended = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[2], status: 'Active' },
        { $set: { status: 'Ended', endedAt: new Date(), endedById: interaction.user.id, updatedAt: new Date() } },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!ended) {
        await interaction.editReply('That 911 call is already ended or unavailable.');
        return true;
    }
    await editCallMessage(interaction.client, ended as unknown as EmergencyDispatchCallRecord).catch(() => undefined);
    await interaction.editReply(`✅ 911 call #${ended.callNumber} ended. Assigned units are now 10-8.`);
    return true;
}

export async function handleEmergencyDispatchV3UserSelect(interaction: UserSelectMenuInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch3:attach-select:([a-f0-9]{16})$/);
    if (!match) return false;
    await interaction.deferUpdate();
    if (!await hasDispatchRole(interaction)) {
        await interaction.editReply({ content: `You need <@&${DISPATCH_ROLE_ID}> to attach units.`, components: [] });
        return true;
    }
    const selectedIds = [...interaction.users.values()].filter(user => !user.bot).map(user => user.id);
    const updated = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[1], status: 'Active' },
        { $addToSet: { assignedDiscordIds: { $each: selectedIds } }, $set: { updatedAt: new Date() } },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!updated) {
        await interaction.editReply({ content: 'That 911 call is no longer active.', components: [] });
        return true;
    }
    await editCallMessage(interaction.client, updated as unknown as EmergencyDispatchCallRecord).catch(() => undefined);
    await interaction.editReply({ content: `✅ ${selectedIds.length} unit${selectedIds.length === 1 ? '' : 's'} attached to call #${updated.callNumber}.`, components: [] });
    return true;
}

export async function handleEmergencyDispatchV3Modal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch3:notes-modal:([a-f0-9]{16})$/);
    if (!match) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await hasDispatchRole(interaction)) {
        await interaction.editReply(`You need <@&${DISPATCH_ROLE_ID}> to write dispatch notes.`);
        return true;
    }
    const updated = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[1], status: 'Active' },
        { $push: { notes: { authorId: interaction.user.id, text: interaction.fields.getTextInputValue('notes').trim(), createdAt: new Date() } }, $set: { updatedAt: new Date() } },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!updated) {
        await interaction.editReply('That 911 call is no longer active.');
        return true;
    }
    await editCallMessage(interaction.client, updated as unknown as EmergencyDispatchCallRecord).catch(() => undefined);
    await interaction.editReply(`✅ Dispatch notes added to call #${updated.callNumber}.`);
    return true;
}

export const emergencyDispatchStatusCommand = {
    data: new SlashCommandBuilder()
        .setName('911-status')
        .setDescription('Dispatch: test ER:LC 911 detection and show its current status')
        .setDMPermission(false),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await hasDispatchRole(interaction)) {
            await interaction.editReply(`You need <@&${DISPATCH_ROLE_ID}> to use this command.`);
            return;
        }
        const diagnostic = await pollEmergencyDispatchV3(interaction.client);
        const channel = await interaction.client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
        const webhookBase = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL || process.env.SELF_URL;
        const webhook = webhookBase ? `${webhookBase.replace(/\/+$/, '')}/erlc-event` : 'Public bot URL is not available in the environment.';
        const checked = diagnostic.checkedAt ? `<t:${Math.floor(diagnostic.checkedAt / 1_000)}:R>` : 'Never';
        const lines = [
            `**Database:** ${isDatabaseAvailable() ? '✅ Connected' : '❌ Offline'}`,
            `**911 Channel:** ${channel?.isSendable() ? `✅ <#${EMERGENCY_CALL_CHANNEL_ID}> accessible` : `❌ <#${EMERGENCY_CALL_CHANNEL_ID}> unavailable`}`,
            `**ER:LC HTTP:** ${diagnostic.httpStatus ?? 'No response'}`,
            `**ER:LC API Code:** ${diagnostic.apiCode ?? 'None'}`,
            `**EmergencyCalls returned:** ${diagnostic.activeCallCount ?? 'Unknown'}`,
            `**EmergencyCalls parsed:** ${diagnostic.parsedCallCount ?? 'Unknown'}`,
            `**Players returned:** ${diagnostic.playerCount ?? 'Unknown'}`,
            `**Last check:** ${checked}`,
            `**Result:** ${safe(diagnostic.message, 500)}`,
            '',
            '**Official ER:LC Event Webhook URL**',
            `\`${webhook}\``,
        ];
        const panel = new ContainerBuilder()
            .setAccentColor(PANEL_COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🚨 911 Dispatch Diagnostics\n${lines.join('\n')}`));
        await interaction.editReply({ components: [panel], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    },
};
