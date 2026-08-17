import { createHash } from 'node:crypto';
import {
    ActionRowBuilder,
    AttachmentBuilder,
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
import { renderErlcCallMap } from '../services/erlcCallMap';
import { logger } from '../utils/logger';

const EMERGENCY_CALL_CHANNEL_ID = '1538695671081861221';
const DISPATCH_ROLE_ID = '1530984749232033963';
const OFFICIAL_POSTAL_MAP_URL = 'https://api.erlc.gg/maps/fall_postals.png';
const PANEL_COLOR = 0x247bf1;
const seenWithoutDatabase = new Set<string>();
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
        const x = numberValue(rawLocation.LocationX ?? rawLocation.locationX ?? rawLocation.X ?? rawLocation.x);
        const z = numberValue(rawLocation.LocationZ ?? rawLocation.locationZ ?? rawLocation.Z ?? rawLocation.z);
        if (x !== null && z !== null) {
            location = {
                x,
                z,
                postalCode: text(rawLocation.PostalCode ?? rawLocation.postalCode ?? rawLocation.postal),
                streetName: text(rawLocation.StreetName ?? rawLocation.streetName ?? rawLocation.street),
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

function parseCaller(value: unknown): { robloxId: string; label: string } {
    const numeric = numberValue(value);
    if (numeric !== null && numeric > 0) {
        return { robloxId: String(Math.trunc(numeric)), label: '' };
    }

    if (isRecord(value)) {
        const nestedId = numberValue(value.UserId ?? value.userId ?? value.Id ?? value.id ?? value.Caller ?? value.caller);
        const nestedName = text(value.Username ?? value.username ?? value.Name ?? value.name);
        if (nestedId !== null && nestedId > 0) {
            return { robloxId: String(Math.trunc(nestedId)), label: nestedName || '' };
        }
    }

    const identity = parseIdentity(value);
    if (identity.robloxId) return { robloxId: identity.robloxId, label: identity.username };
    return {
        robloxId: 'System',
        label: identity.username !== 'Unknown' ? identity.username : 'System',
    };
}

function parseCall(value: unknown): ParsedCall | null {
    if (!isRecord(value)) return null;
    const position = Array.isArray(value.Position)
        ? value.Position
        : Array.isArray(value.position)
            ? value.position
            : [];
    const x = numberValue(position[0] ?? value.LocationX ?? value.locationX ?? value.X ?? value.x);
    const z = numberValue(position[1] ?? value.LocationZ ?? value.locationZ ?? value.Z ?? value.z);
    const callNumber = numberValue(value.CallNumber ?? value.callNumber ?? value.Number ?? value.number);
    if (x === null || z === null || callNumber === null) return null;

    const caller = parseCaller(value.Caller ?? value.caller ?? value.Player ?? value.player ?? value.User ?? value.user);
    return {
        team: text(value.Team ?? value.team ?? value.Service ?? value.service) || 'Emergency Services',
        callerRobloxId: caller.robloxId,
        callerLabel: caller.label,
        positionX: x,
        positionZ: z,
        startedAt: unixSeconds(value.StartedAt ?? value.startedAt ?? value.Timestamp ?? value.timestamp),
        callNumber: Math.trunc(callNumber),
        description: text(value.Description ?? value.description ?? value.Message ?? value.message ?? value.Incident ?? value.incident)
            || '911 emergency call received.',
        positionDescriptor: text(
            value.PositionDescriptor
            ?? value.positionDescriptor
            ?? value.LocationDescriptor
            ?? value.locationDescriptor
            ?? value.LocationName
            ?? value.locationName,
        ) || 'Location received from ER:LC.',
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
    if (!clean) return 'Unavailable';
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function mapFilename(callNumber: number): string {
    return `erlc-911-map-${callNumber}.png`;
}

function closestText(record: EmergencyDispatchCallRecord): string {
    if (!record.closestUnits.length) return '*No nearby matching units were available in this snapshot.*';
    return record.closestUnits.map((unit, i) => {
        const callsign = unit.callsign ? `**${safe(unit.callsign, 40)}** • ` : '';
        const location = [unit.streetName, unit.postalCode ? `Postal ${unit.postalCode}` : null]
            .filter(Boolean)
            .join(' • ');
        return `**${i + 1}.** ${callsign}${safe(unit.robloxUsername, 80)}${location ? ` — ${safe(location, 120)}` : ''}`;
    }).join('\n');
}

function assignedText(record: EmergencyDispatchCallRecord): string {
    return record.assignedDiscordIds.length
        ? record.assignedDiscordIds.map(id => `<@${id}>`).join(' • ')
        : '*No units assigned yet.*';
}

function notesText(record: EmergencyDispatchCallRecord): string {
    if (!record.notes.length) return '*No dispatch notes added yet.*';
    return record.notes.slice(-6).map(note => {
        const unix = Math.floor(new Date(note.createdAt).getTime() / 1_000);
        return `• <@${note.authorId}> • <t:${unix}:R> — ${safe(note.text, 450)}`;
    }).join('\n');
}

function buildPanel(record: EmergencyDispatchCallRecord, mapUrl: string): ContainerBuilder {
    const ended = record.status === 'Ended';
    const callerId = /^\d+$/.test(record.callerRobloxId)
        ? ` • Roblox ID \`${record.callerRobloxId}\``
        : '';

    return new ContainerBuilder()
        .setAccentColor(ended ? 0x6b7280 : PANEL_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            ended ? `## ✅ 911 Call Closed: ${safe(record.team, 80)}` : `## 📞 911 Call Received: ${safe(record.team, 80)}`,
            `**Caller:** ${safe(record.callerRobloxUsername, 90)}${callerId}`,
            `**Incident:** ${safe(record.description, 1_000)}`,
            `**Location:** ${safe(record.positionDescriptor, 500)}`,
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
            '### 🗺️ ER:LC Call Map',
            `**${safe(record.positionDescriptor, 500)}**`,
        ].join('\n')))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
                .setURL(mapUrl)
                .setDescription(`ER:LC 911 map for call #${record.callNumber}`),
        ))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '### 📝 Dispatch Notes',
            notesText(record),
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`dispatch911:attach:${record.dispatchId}`)
                .setLabel('Attach Units')
                .setEmoji('🚓')
                .setStyle(ButtonStyle.Success)
                .setDisabled(ended),
            new ButtonBuilder()
                .setCustomId(`dispatch911:notes:${record.dispatchId}`)
                .setLabel('Add Notes')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(ended),
            new ButtonBuilder()
                .setCustomId(`dispatch911:end:${record.dispatchId}`)
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

async function loadRecord(dispatchIdValue: string): Promise<EmergencyDispatchCallRecord | null> {
    const live = liveCalls.get(dispatchIdValue);
    if (live) return live;
    if (!isDatabaseAvailable()) return null;
    const stored = await EmergencyDispatchCall.findOne({ dispatchId: dispatchIdValue }).lean().exec().catch(() => null);
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
        logger.warn(`[911 Integrated] Could not persist call #${record.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

async function editCallMessage(client: Client, record: EmergencyDispatchCallRecord): Promise<void> {
    if (!record.channelId || !record.messageId) return;
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return;

    const expectedName = mapFilename(record.callNumber);
    const hasMapAttachment = message.attachments.some(attachment => attachment.name === expectedName);
    const mapUrl = hasMapAttachment ? `attachment://${expectedName}` : OFFICIAL_POSTAL_MAP_URL;
    await message.edit({
        components: [buildPanel(record, mapUrl)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function postCall(client: Client, guildId: string, call: ParsedCall, players: ParsedPlayer[]): Promise<void> {
    const id = dispatchId(guildId, call);

    if (isDatabaseAvailable()) {
        const existing = await EmergencyDispatchCall.findOne({
            guildId,
            callNumber: call.callNumber,
            startedAt: call.startedAt,
        }).lean().exec().catch(() => null);
        if (existing?.messageId) {
            liveCalls.set(existing.dispatchId, existing as unknown as EmergencyDispatchCallRecord);
            return;
        }
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
    liveCalls.set(id, record);

    if (isDatabaseAvailable()) {
        await EmergencyDispatchCall.findOneAndUpdate(
            { guildId, callNumber: call.callNumber, startedAt: call.startedAt },
            { $setOnInsert: record },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).exec().catch(() => null);
    } else {
        seenWithoutDatabase.add(id);
    }

    const renderedMap = await renderErlcCallMap(
        record.positionX,
        record.positionZ,
        record.callNumber,
        record.positionDescriptor,
    );
    const files = renderedMap
        ? [new AttachmentBuilder(renderedMap.buffer, { name: renderedMap.filename })]
        : [];
    const mapUrl = renderedMap ? `attachment://${renderedMap.filename}` : OFFICIAL_POSTAL_MAP_URL;

    const message = await channel.send({
        components: [buildPanel(record, mapUrl)],
        files,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });

    record.messageId = message.id;
    record.channelId = message.channelId;
    await persistRecord(record);
    logger.info(`[911 Integrated] Posted ${/^\d+$/.test(call.callerRobloxId) ? 'PLAYER' : 'SYSTEM'} call #${call.callNumber} from ${record.callerRobloxUsername}.`);
}

function emergencyCallsArray(payload: UnknownRecord): unknown[] {
    if (Array.isArray(payload.EmergencyCalls)) return payload.EmergencyCalls;
    if (Array.isArray(payload.emergencyCalls)) return payload.emergencyCalls;
    const nested = isRecord(payload.data) ? payload.data : isRecord(payload.Data) ? payload.Data : null;
    if (nested && Array.isArray(nested.EmergencyCalls)) return nested.EmergencyCalls;
    if (nested && Array.isArray(nested.emergencyCalls)) return nested.emergencyCalls;
    return [];
}

/** Consume EmergencyCalls from the same v2 HTTP response used by the main ER:LC monitor. */
export async function processIntegratedEmergencyCalls(client: Client, payload: unknown): Promise<void> {
    if (!isRecord(payload)) return;
    const guildId = process.env.GUILD_ID || client.guilds.cache.firstKey();
    if (!guildId) return;

    const rawCalls = emergencyCallsArray(payload);
    const calls = rawCalls.map(parseCall).filter((call): call is ParsedCall => Boolean(call));
    const rawPlayers = Array.isArray(payload.Players)
        ? payload.Players
        : Array.isArray(payload.players)
            ? payload.players
            : [];
    const players = rawPlayers.map(parsePlayer).filter((player): player is ParsedPlayer => Boolean(player));

    const playerCalls = calls.filter(call => /^\d+$/.test(call.callerRobloxId)).length;
    const systemCalls = calls.length - playerCalls;
    const rawCallerTypes = rawCalls
        .slice(0, 8)
        .map(call => isRecord(call) ? `${typeof (call.Caller ?? call.caller)}:${String(call.Caller ?? call.caller ?? 'missing').slice(0, 24)}` : typeof call)
        .join(', ');
    logger.info(`[911 Integrated] ER:LC returned ${rawCalls.length} raw call(s); parsed ${calls.length} (${playerCalls} player / ${systemCalls} system). Caller samples: ${rawCallerTypes || 'none'}.`);

    for (const call of calls.sort((a, b) => a.startedAt - b.startedAt)) {
        await postCall(client, guildId, call, players).catch(error => {
            logger.warn(`[911 Integrated] Could not post call #${call.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }
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

function notesModal(dispatchIdValue: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`dispatch911:notes-modal:${dispatchIdValue}`)
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

export async function handleIntegratedEmergencyDispatchButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch911:(attach|notes|end):([a-f0-9]{16})$/);
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
            .setCustomId(`dispatch911:attach-select:${record.dispatchId}`)
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

export async function handleIntegratedEmergencyDispatchUserSelect(
    interaction: UserSelectMenuInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch911:attach-select:([a-f0-9]{16})$/);
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

export async function handleIntegratedEmergencyDispatchModal(
    interaction: ModalSubmitInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatch911:notes-modal:([a-f0-9]{16})$/);
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
