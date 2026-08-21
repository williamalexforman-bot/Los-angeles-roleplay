import {
    ChannelType,
    Client,
    Events,
    type Guild,
    type GuildMember,
    type SendableChannels,
} from 'discord.js';
import {
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    type VoiceConnection,
} from '@discordjs/voice';
import { logger } from '../utils/logger';

// prism-media is CommonJS and its decoder works with opusscript when a native
// Opus package is unavailable on Render.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prism = require('prism-media') as {
    opus: {
        Decoder: new (options: { rate: number; channels: number; frameSize: number }) => NodeJS.ReadWriteStream;
    };
};

const VOICE_CHANNEL_ID = '1528089390054637799';
const VOICE_MOD_LOG_CHANNEL_ID = '1540340428274929847';
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const MAX_CLIP_MS = 20_000;
const MIN_CLIP_MS = 450;
const SILENCE_END_MS = 1_200;
const RECONNECT_DELAY_MS = 5_000;

const registeredClients = new WeakSet<Client>();
const activeSpeakers = new Set<string>();
let connection: VoiceConnection | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function enabled(): boolean {
    return String(process.env.VOICE_MODERATION_ENABLED || 'true').toLowerCase() !== 'false';
}

function clipDurationMs(pcmBytes: number): number {
    const bytesPerSecond = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
    return Math.round((pcmBytes / bytesPerSecond) * 1_000);
}

function pcmToWav(pcm: Buffer): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
    const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function transcribeWav(wav: Buffer): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        logger.warn('[VoiceMod] OPENAI_API_KEY is missing; voice clips cannot be transcribed.');
        return '';
    }

    const form = new FormData();
    form.append('model', process.env.VOICE_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe');
    form.append('file', new Blob([wav], { type: 'audio/wav' }), `voice-${Date.now()}.wav`);

    try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            const details = await response.text().catch(() => '');
            logger.warn(`[VoiceMod] Transcription failed (${response.status}): ${details.slice(0, 240)}`);
            return '';
        }
        const payload = await response.json() as { text?: unknown };
        return typeof payload.text === 'string' ? payload.text.trim() : '';
    } catch (error) {
        logger.warn(`[VoiceMod] Transcription request failed: ${error instanceof Error ? error.message : String(error)}`);
        return '';
    }
}

type Flag = { reason: 'Profanity' | 'Raid Threat' | 'Trolling'; evidence: string } | null;

function detectFlag(transcript: string): Flag {
    const text = transcript.toLowerCase();

    // Explicit threats to raid/spam/attack the server get highest priority.
    const raidPatterns = [
        /\b(?:i(?:'m| am|’m)?|we(?:'re| are|’re)?)\s+(?:gonna|going to|about to|will)\s+(?:raid|spam|attack|nuke)\b/i,
        /\b(?:raid|nuke|spam)\s+(?:this|the)\s+(?:server|discord)\b/i,
        /\b(?:bringing|bring|get|gettin(?:g)?)\s+(?:people|friends|alts|bots)\s+(?:to|and)\s+(?:raid|spam|attack)\b/i,
    ];
    for (const pattern of raidPatterns) {
        if (pattern.test(text)) return { reason: 'Raid Threat', evidence: 'Speech matched a raid/spam threat pattern.' };
    }

    // Common explicit profanity. Keep this focused on clear curse words rather
    // than trying to infer identity-based slurs from imperfect transcription.
    const profanity = /\b(?:fuck(?:ing|ed|er|ers)?|shit(?:ty)?|bitch(?:es)?|asshole(?:s)?|motherfucker(?:s)?|dickhead(?:s)?|bullshit)\b/i;
    if (profanity.test(text)) return { reason: 'Profanity', evidence: 'Speech contained explicit profanity.' };

    // Verbal trolling / disruption statements that are clear enough to act on.
    const trolling = /\b(?:i(?:'m| am|’m)?\s+(?:just\s+)?trolling|this is (?:a )?troll|mic\s*spam|i(?:'m| am|’m)?\s+(?:gonna|going to)\s+(?:spam|troll|annoy|disrupt)|trying to (?:troll|annoy|disrupt)|let(?:'s| us)\s+(?:troll|spam))\b/i;
    if (trolling.test(text)) return { reason: 'Trolling', evidence: 'Speech explicitly described trolling or intentional disruption.' };

    return null;
}

async function fetchLogChannel(client: Client): Promise<SendableChannels | null> {
    const channel = await client.channels.fetch(VOICE_MOD_LOG_CHANNEL_ID).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

async function sendFlag(
    client: Client,
    member: GuildMember | null,
    userId: string,
    transcript: string,
    flag: NonNullable<Flag>,
    wav: Buffer,
): Promise<void> {
    const channel = await fetchLogChannel(client);
    if (!channel) {
        logger.warn(`[VoiceMod] Log channel ${VOICE_MOD_LOG_CHANNEL_ID} is unavailable or not sendable.`);
        return;
    }

    const username = member?.user.tag || member?.user.username || 'Unknown user';
    const safeTranscript = transcript.length > 1_500 ? `${transcript.slice(0, 1_497)}...` : transcript;

    await channel.send({
        content: [
            `🎙️ **Voice Moderation Flag — ${flag.reason}**`,
            `**User:** <@${userId}> (\`${username}\` • \`${userId}\`)`,
            `**Voice Channel:** <#${VOICE_CHANNEL_ID}>`,
            `**Reason:** ${flag.evidence}`,
            `**Transcript:** ${safeTranscript ? `\`${safeTranscript.replace(/`/g, "'")}\`` : '`Unavailable`'}`,
            '**Audio:** Flagged speech clip attached below.',
        ].join('\n'),
        files: [{ attachment: wav, name: `voice-flag-${userId}-${Date.now()}.wav` }],
        allowedMentions: { parse: [] },
    });

    logger.info(`[VoiceMod] Sent ${flag.reason} clip for ${userId} to ${VOICE_MOD_LOG_CHANNEL_ID}.`);
}

async function processSpeech(client: Client, guild: Guild, userId: string, pcm: Buffer): Promise<void> {
    const duration = clipDurationMs(pcm.length);
    if (duration < MIN_CLIP_MS) return;

    const wav = pcmToWav(pcm);
    const transcript = await transcribeWav(wav);
    if (!transcript) return;

    const flag = detectFlag(transcript);
    if (!flag) {
        logger.info(`[VoiceMod] Clean ${duration}ms clip discarded for ${userId}.`);
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    await sendFlag(client, member, userId, transcript, flag, wav).catch(error => {
        logger.warn(`[VoiceMod] Could not send flagged clip for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function attachReceiver(client: Client, guild: Guild, voice: VoiceConnection): void {
    voice.receiver.speaking.on('start', userId => {
        if (activeSpeakers.has(userId) || userId === client.user?.id) return;
        activeSpeakers.add(userId);

        const opusStream = voice.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_END_MS },
        });
        const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let finished = false;

        const finish = (): void => {
            if (finished) return;
            finished = true;
            clearTimeout(maxTimer);
            activeSpeakers.delete(userId);
            const pcm = Buffer.concat(chunks, totalBytes);
            void processSpeech(client, guild, userId, pcm).catch(error => {
                logger.warn(`[VoiceMod] Speech processing failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
            });
        };

        const maxTimer = setTimeout(() => {
            opusStream.destroy();
            decoder.destroy();
            finish();
        }, MAX_CLIP_MS);

        decoder.on('data', (chunk: Buffer) => {
            if (!Buffer.isBuffer(chunk)) return;
            chunks.push(chunk);
            totalBytes += chunk.length;
        });
        decoder.once('end', finish);
        decoder.once('close', finish);
        decoder.once('error', error => {
            logger.warn(`[VoiceMod] Opus decoder failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
            finish();
        });
        opusStream.once('error', error => {
            logger.warn(`[VoiceMod] Voice receive stream failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
            finish();
        });
        opusStream.pipe(decoder);
    });
}

function scheduleReconnect(client: Client): void {
    if (reconnectTimer || !enabled()) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectVoiceModeration(client);
    }, RECONNECT_DELAY_MS);
    reconnectTimer.unref?.();
}

async function connectVoiceModeration(client: Client): Promise<void> {
    if (!enabled()) return;

    const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        logger.warn(`[VoiceMod] Voice channel ${VOICE_CHANNEL_ID} is unavailable or is not a normal voice channel.`);
        scheduleReconnect(client);
        return;
    }

    if (!process.env.OPENAI_API_KEY?.trim()) {
        logger.warn('[VoiceMod] OPENAI_API_KEY is missing. The bot can join voice but cannot transcribe/moderate speech.');
    }

    const existing = getVoiceConnection(channel.guild.id);
    if (existing) existing.destroy();

    connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.warn('[VoiceMod] Voice connection disconnected; scheduling reconnect.');
        scheduleReconnect(client);
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
        scheduleReconnect(client);
    });
    connection.on('error', error => {
        logger.warn(`[VoiceMod] Voice connection error: ${error instanceof Error ? error.message : String(error)}`);
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        attachReceiver(client, channel.guild, connection);
        logger.info(`[VoiceMod] Connected to voice channel ${VOICE_CHANNEL_ID}; flagged clips will go to ${VOICE_MOD_LOG_CHANNEL_ID}.`);
    } catch (error) {
        logger.warn(`[VoiceMod] Could not become ready in voice channel: ${error instanceof Error ? error.message : String(error)}`);
        connection.destroy();
        scheduleReconnect(client);
    }
}

export function registerVoiceModeration(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    if (!enabled()) {
        logger.info('[VoiceMod] Disabled by VOICE_MODERATION_ENABLED=false.');
        return;
    }

    void connectVoiceModeration(client);

    // If the bot is manually disconnected or moved, restore the configured
    // moderation channel automatically.
    client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
        if (newState.id !== client.user?.id) return;
        if (newState.channelId !== VOICE_CHANNEL_ID) scheduleReconnect(client);
    });

    logger.info('[VoiceMod] Voice moderation registration active; clean clips are discarded after transcription.');
}
