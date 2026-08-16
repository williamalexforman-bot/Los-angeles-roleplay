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
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PANEL_COLOR = 0x247bf1;

let emergencyDispatchTimer: ReturnType<typeof setInterval> | null = null;
let emergencyDispatchPollActive = false;

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

interface ParsedEmergencyCall {
    team: string;
    callerRobloxId: string;
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
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseIdentity(value: unknown): { username: string; robloxId: string | null } {
    const raw = text(value) || '';
    const separator = raw.lastIndexOf(':');
    if (separator <= 0 || separator === raw.length - 1) {
        return { username: raw || 'Unknown', robloxId: null };
    }
    const username = raw.slice(0, separator).trim();
    const id = raw.slice(separator + 1).trim();
    return {
        username: username || 'Unknown',
        robloxId: /^\d+$/.test(id) ? id : null,
    };
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

function parseEmergencyCall(value: unknown): ParsedEmergencyCall | null {
    if (!isRecord(value)) return null;
    const team = text(value.Team) || 'Emergency Services';
    const caller = finiteNumber(value.Caller);
    const startedAt = finiteNumber(value.StartedAt);
    const callNumber = finiteNumber(value.CallNumber);
    const position = Array.isArray(value.Position) ? value.Position : [];
    const x = finiteNumber(position[0]);
    const z = finiteNumber(position[1]);
    if (caller === null || startedAt === null || callNumber === null || x === null || z === null) return null;

    return {
        team,
        callerRobloxId: String(Math.trunc(caller)),
        positionX: x,
        positionZ: z,
        startedAt: Math.trunc(startedAt),
        callNumber: Math.trunc(callNumber),
        description: text(value.Description) || 'No additional information was provided.',
        positionDescriptor: text(value.PositionDescriptor) || 'Location description unavailable.',
    };
}

function safeText(value: string, max = 1_500): string {
    const clean = value
        .replace(/```/g, "'''")
        .replace(/@/g, '@\u200b')
        .trim();
    if (!clean) return 'Unavailable';
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function dispatchId(guildId: string, call: ParsedEmergencyCall): string {
    return createHash('sha256')
        .update(`${guildId}:${call.callNumber}:${call.startedAt}:${call.callerRobloxId}`)
        .digest('hex')
        .slice(0, 16);
}

function serviceLabel(team: string): string {
    const normalized = team.toLowerCase();
    if (normalized.includes('police') || normalized.includes('sheriff') || normalized.includes('law')) return 'Law Enforcement';
    if (normalized.includes('fire') || normalized.includes('ems') || normalized.includes('medical')) return 'Fire & Rescue';
    return team || 'Emergency Services';
}

function isRelevantUnit(callTeam: string, playerTeam: string): boolean {
    const call = callTeam.toLowerCase();
    const team = playerTeam.toLowerCase();
    if (call.includes('police') || call.includes('sheriff') || call.includes('law')) {
        return team.includes('police') || team.includes('sheriff');
    }
    if (call.includes('fire') || call.includes('ems') || call.includes('medical')) {
        return team.includes('fire') || team.includes('ems') || team.includes('medical');
    }
    return team === call;
}

function closestUnits(call: ParsedEmergencyCall, players: ParsedPlayer[]): EmergencyDispatchClosestUnit[] {
    return players
        .filter(player => player.location && isRelevantUnit(call.team, player.team))
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
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 3);
}

async function resolveRobloxUsername(robloxId: string, players: ParsedPlayer[]): Promise<string> {
    const current = players.find(player => player.robloxId === robloxId)?.username;
    if (current) return current;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(robloxId)}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) return `Roblox User ${robloxId}`;
        const payload = await response.json().catch(() => null);
        return isRecord(payload) && text(payload.name) ? text(payload.name)! : `Roblox User ${robloxId}`;
    } catch {
        return `Roblox User ${robloxId}`;
    } finally {
        clearTimeout(timer);
    }
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function mapGallery(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(ERLC_POSTAL_MAP_URL),
    );
}

function closestUnitsText(record: EmergencyDispatchCallRecord): string {
    if (!record.closestUnits.length) return '*No nearby matching units were available in the latest ER:LC snapshot.*';
    return record.closestUnits.map((unit, index) => {
        const location = [unit.streetName, unit.postalCode ? `Postal ${unit.postalCode}` : null]
            .filter(Boolean)
            .join(' • ');
        const callsign = unit.callsign ? `${unit.callsign} • ` : '';
        return `**${index + 1}.** ${callsign}${safeText(unit.robloxUsername, 80)}${location ? ` — ${safeText(location, 120)}` : ''} • ~${Math.round(unit.distance)} studs`;
    }).join('\n');
}

function assignedUnitsText(record: EmergencyDispatchCallRecord): string {
    return record.assignedDiscordIds.length
        ? record.assignedDiscordIds.map(id => `<@${id}>`).join(' • ')
        : '*No units assigned yet.*';
}

function notesText(record: EmergencyDispatchCallRecord): string {
    if (!record.notes.length) return '*No dispatch notes added yet.*';
    return record.notes.slice(-5).map(note => {
        const timestamp = Math.floor(new Date(note.createdAt).getTime() / 1_000);
        return `• <@${note.authorId}> • <t:${timestamp}:R> — ${safeText(note.text, 500)}`;
    }).join('\n');
}

export function buildEmergencyDispatchPanel(record: EmergencyDispatchCallRecord): ContainerBuilder {
    const ended = record.status === 'Ended';
    const title = ended
        ? `## ✅ 911 Call Closed: ${serviceLabel(record.team)}`
        : `## 📞 911 Call Received: ${serviceLabel(record.team)}`;
    const status = ended
        ? `🔴 **Ended**${record.endedById ? ` by <@${record.endedById}>` : ''} • Assigned units are 10-8.`
        : '🟢 **Active**';

    const attachButton = new ButtonBuilder()
        .setCustomId(`dispatch:attach:${record.dispatchId}`)
        .setLabel('Attach Unit')
        .setEmoji('🚓')
        .setStyle(ButtonStyle.Success)
        .setDisabled(ended);
    const notesButton = new ButtonBuilder()
        .setCustomId(`dispatch:notes:${record.dispatchId}`)
        .setLabel('Add Notes')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(ended);
    const endButton = new ButtonBuilder()
        .setCustomId(`dispatch:end:${record.dispatchId}`)
        .setLabel('End Call')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(ended);

    return new ContainerBuilder()
        .setAccentColor(ended ? 0x6b7280 : PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            title,
            `**Caller:** ${safeText(record.callerRobloxUsername, 80)} • Roblox ID \`${record.callerRobloxId}\``,
            `**Incident:** ${safeText(record.description, 1_000)}`,
            `**Location:** ${safeText(record.positionDescriptor, 500)}`,
            `**Call Number:** \`${record.callNumber}\``,
            `**Time:** <t:${record.startedAt}:F> • <t:${record.startedAt}:R>`,
            `**Status:** ${status}`,
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🚔 Closest Units',
            closestUnitsText(record),
            '',
            '### 👥 Assigned Units',
            assignedUnitsText(record),
        ].join('\n')))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 🗺️ ER:LC Call Location',
            `📍 **Map Coordinates:** X \`${record.positionX.toFixed(1)}\` • Z \`${record.positionZ.toFixed(1)}\``,
            `**Location:** ${safeText(record.positionDescriptor, 500)}`,
        ].join('\n')))
        .addMediaGalleryComponents(mapGallery())
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 📝 Dispatch Notes',
            notesText(record),
        ].join('\n')))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(attachButton, notesButton, endButton),
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `*Los Angeles Roleplay • 911 Emergency Dispatch • Call #${record.callNumber}*`,
        ));
}

function hasDispatchRole(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    const member = interaction.member;
    if (member instanceof GuildMember) return member.roles.cache.has(DISPATCH_ROLE_ID);
    return Boolean(member && Array.isArray(member.roles) && member.roles.includes(DISPATCH_ROLE_ID));
}

async function editStoredCallMessage(client: Client, record: EmergencyDispatchCallRecord): Promise<void> {
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel) || !record.messageId) return;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
        components: [buildEmergencyDispatchPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

function notesModal(dispatchIdValue: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`dispatch:notes-modal:${dispatchIdValue}`)
        .setTitle('Add Dispatch Notes')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('notes')
                    .setLabel('Dispatch notes')
                    .setPlaceholder('Enter information responders should know about this call.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(2)
                    .setMaxLength(1_000),
            ),
        );
}

export async function handleEmergencyDispatchButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch:(attach|notes|end):([a-f0-9]{16})$/);
    if (!match) return false;

    if (!hasDispatchRole(interaction)) {
        await interaction.reply({
            content: `You need <@&${DISPATCH_ROLE_ID}> to manage 911 dispatch calls.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const action = match[1];
    const id = match[2];
    if (action === 'notes') {
        const existing = await EmergencyDispatchCall.findOne({ dispatchId: id }).lean().exec().catch(() => null);
        if (!existing || existing.status !== 'Active') {
            await interaction.reply({ content: 'That dispatch call is no longer active.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(notesModal(id));
        return true;
    }

    await interaction.deferUpdate();
    if (action === 'attach') {
        const updatedRaw = await EmergencyDispatchCall.findOneAndUpdate(
            { dispatchId: id, status: 'Active' },
            {
                $addToSet: { assignedDiscordIds: interaction.user.id },
                $set: { updatedAt: new Date() },
            },
            { new: true },
        ).lean().exec().catch(() => null);
        if (!updatedRaw) {
            await interaction.followUp({ content: 'That dispatch call is no longer active.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const updated = updatedRaw as unknown as EmergencyDispatchCallRecord;
        await editStoredCallMessage(interaction.client, updated).catch(() => undefined);
        await interaction.followUp({
            content: `✅ You are attached to 911 call #${updated.callNumber}. Your Discord ping is now shown under Assigned Units.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const endedRaw = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: id, status: 'Active' },
        {
            $set: {
                status: 'Ended',
                endedAt: new Date(),
                endedById: interaction.user.id,
                updatedAt: new Date(),
            },
        },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!endedRaw) {
        await interaction.followUp({ content: 'That dispatch call is already ended or unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const ended = endedRaw as unknown as EmergencyDispatchCallRecord;
    await editStoredCallMessage(interaction.client, ended).catch(() => undefined);
    await interaction.followUp({
        content: `✅ 911 call #${ended.callNumber} has been ended in the Discord dispatch panel. Assigned units are now shown 10-8.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

export async function handleEmergencyDispatchModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch:notes-modal:([a-f0-9]{16})$/);
    if (!match) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!hasDispatchRole(interaction)) {
        await interaction.editReply(`You need <@&${DISPATCH_ROLE_ID}> to add dispatch notes.`);
        return true;
    }

    const note = interaction.fields.getTextInputValue('notes').trim();
    const updatedRaw = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[1], status: 'Active' },
        {
            $push: {
                notes: {
                    authorId: interaction.user.id,
                    text: note,
                    createdAt: new Date(),
                },
            },
            $set: { updatedAt: new Date() },
        },
        { new: true },
    ).lean().exec().catch(() => null);
    if (!updatedRaw) {
        await interaction.editReply('That dispatch call is no longer active.');
        return true;
    }

    const updated = updatedRaw as unknown as EmergencyDispatchCallRecord;
    await editStoredCallMessage(interaction.client, updated).catch(() => undefined);
    await interaction.editReply(`✅ Notes added to 911 call #${updated.callNumber}.`);
    return true;
}

async function fetchDispatchSnapshot(): Promise<{ calls: ParsedEmergencyCall[]; players: ParsedPlayer[] } | null> {
    const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
    if (!serverKey) return null;

    const url = new URL(ERLC_SERVER_ENDPOINT);
    url.searchParams.set('Players', 'true');
    url.searchParams.set('EmergencyCalls', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'server-key': serverKey,
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            logger.warn(`[911 Dispatch] ER:LC snapshot returned HTTP ${response.status}.`);
            return null;
        }
        const payload = await response.json().catch(() => null);
        if (!isRecord(payload)) return null;
        const calls = Array.isArray(payload.EmergencyCalls)
            ? payload.EmergencyCalls.map(parseEmergencyCall).filter((call): call is ParsedEmergencyCall => Boolean(call))
            : [];
        const players = Array.isArray(payload.Players)
            ? payload.Players.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player))
            : [];
        return { calls, players };
    } catch (error) {
        logger.warn(`[911 Dispatch] ER:LC emergency-call fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function postNewEmergencyCall(client: Client, guildId: string, call: ParsedEmergencyCall, players: ParsedPlayer[]): Promise<void> {
    const id = dispatchId(guildId, call);
    const existing = await EmergencyDispatchCall.findOne({ dispatchId: id }).lean().exec().catch(() => null);
    if (existing?.messageId) return;

    const channel = await client.channels.fetch(EMERGENCY_CALL_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[911 Dispatch] Channel ${EMERGENCY_CALL_CHANNEL_ID} is unavailable.`);
        return;
    }

    const callerUsername = await resolveRobloxUsername(call.callerRobloxId, players);
    let record: EmergencyDispatchCallRecord;
    if (existing) {
        record = existing as unknown as EmergencyDispatchCallRecord;
    } else {
        try {
            const document = await EmergencyDispatchCall.create({
                dispatchId: id,
                guildId,
                callNumber: call.callNumber,
                startedAt: call.startedAt,
                team: call.team,
                callerRobloxId: call.callerRobloxId,
                callerRobloxUsername: callerUsername,
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
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            record = document.toObject() as EmergencyDispatchCallRecord;
        } catch (error) {
            if ((error as { code?: number }).code === 11000) return;
            throw error;
        }
    }

    const message = await channel.send({
        components: [buildEmergencyDispatchPanel(record)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    await EmergencyDispatchCall.updateOne(
        { dispatchId: id },
        {
            $set: {
                messageId: message.id,
                channelId: message.channelId,
                updatedAt: new Date(),
            },
        },
    ).exec();
    logger.info(`[911 Dispatch] Posted ER:LC call #${call.callNumber} (${id}).`);
}

export async function pollEmergencyDispatch(client: Client): Promise<void> {
    if (emergencyDispatchPollActive || !isDatabaseAvailable()) return;
    if (!(process.env.ERLC_SERVER_KEY || '').trim()) return;
    emergencyDispatchPollActive = true;
    try {
        const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
        if (!guildId) return;
        const snapshot = await fetchDispatchSnapshot();
        if (!snapshot) return;
        for (const call of snapshot.calls.sort((left, right) => left.startedAt - right.startedAt)) {
            await postNewEmergencyCall(client, guildId, call, snapshot.players).catch(error => {
                logger.warn(`[911 Dispatch] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
    } finally {
        emergencyDispatchPollActive = false;
    }
}

export function startEmergencyDispatchWatcher(client: Client): void {
    if (emergencyDispatchTimer) clearInterval(emergencyDispatchTimer);
    emergencyDispatchTimer = null;

    if (!(process.env.ERLC_SERVER_KEY || '').trim()) {
        logger.warn('[911 Dispatch] ERLC_SERVER_KEY is not configured; emergency-call detection is disabled.');
        return;
    }

    const configured = Number(process.env.ERLC_911_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
    const interval = Number.isFinite(configured)
        ? Math.max(MIN_POLL_INTERVAL_MS, Math.floor(configured))
        : DEFAULT_POLL_INTERVAL_MS;

    void pollEmergencyDispatch(client).catch(error => {
        logger.warn(`[911 Dispatch] Initial poll failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    emergencyDispatchTimer = setInterval(() => {
        void pollEmergencyDispatch(client).catch(error => {
            logger.warn(`[911 Dispatch] Poll failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }, interval);
    logger.info(`[911 Dispatch] Emergency-call watcher active every ${Math.round(interval / 1_000)} seconds.`);
}

export function stopEmergencyDispatchWatcher(): void {
    if (!emergencyDispatchTimer) return;
    clearInterval(emergencyDispatchTimer);
    emergencyDispatchTimer = null;
}
