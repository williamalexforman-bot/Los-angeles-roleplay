import { createPublicKey, verify } from 'crypto';
import { createServer, get as httpGet, type IncomingMessage, type ServerResponse } from 'http';
import { get as httpsGet } from 'https';
import { Client, EmbedBuilder } from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { logger } from '../utils/logger';

const MAX_BODY_BYTES = 1_000_000;
const SIGNATURE_REPLAY_WINDOW_MS = 10 * 60 * 1_000;
const processedSignatures = new Map<string, number>();

class WebhookDeliveryError extends Error {}
const ERLC_PUBLIC_KEY = createPublicKey({
    key: Buffer.from('MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=', 'base64'),
    format: 'der',
    type: 'spki',
});

function respond(response: ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const rawChunk of request) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new Error('Payload too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function verifyErlcSignature(request: IncomingMessage, rawBody: Buffer): boolean {
    const timestamp = request.headers['x-signature-timestamp'];
    const signatureHex = request.headers['x-signature-ed25519'];
    if (typeof timestamp !== 'string' || typeof signatureHex !== 'string' || !/^[a-f0-9]+$/i.test(signatureHex)) return false;
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() - timestampSeconds * 1000) > 5 * 60 * 1000) return false;
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
    try {
        return verify(null, message, ERLC_PUBLIC_KEY, Buffer.from(signatureHex, 'hex'));
    } catch {
        return false;
    }
}

async function sendEmbed(client: Client, channelId: string, embed: EmbedBuilder): Promise<void> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) throw new WebhookDeliveryError(`Discord destination ${channelId} is unavailable.`);
    try {
        await channel.send({ embeds: [embed], files: [createLogoAttachment()], allowedMentions: { parse: [] } });
    } catch {
        throw new WebhookDeliveryError(`Discord delivery to ${channelId} failed.`);
    }
}

function baseEmbed(title: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(title)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
}

async function processLegacyEvent(client: Client, payload: Record<string, unknown>): Promise<void> {
    const eventType = String(payload.event || payload.type || '');
    if (eventType === 'teamSwitch') {
        const player = String(payload.userName || payload.playerName || payload.player || 'Unknown');
        const previousTeam = String(payload.fromTeam || payload.teamFrom || payload.from || 'Unknown');
        const newTeam = String(payload.toTeam || payload.teamTo || payload.to || 'Unknown');
        await sendEmbed(client, CHANNEL_IDS.erlcTeamChangeLog, baseEmbed('ER:LC Team Changed').addFields(
            { name: 'Player', value: player, inline: true },
            { name: 'Previous Team', value: previousTeam, inline: true },
            { name: 'New Team', value: newTeam, inline: true },
            { name: 'Detected', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
        ));
        return;
    }
    if (eventType === 'gameCommand') {
        const command = String(payload.command || payload.action || 'Unknown');
        const player = String(payload.userName || payload.playerName || payload.player || 'Unknown');
        await sendEmbed(client, CHANNEL_IDS.erlcCommandLog, baseEmbed('ER:LC Command Event').addFields(
            { name: 'Roblox Player', value: player, inline: true },
            { name: 'Command', value: command.slice(0, 1024) },
            { name: 'Source', value: 'Configured Legacy Webhook', inline: true },
        ));
    }
}

async function processOfficialErlcEvent(client: Client, payload: Record<string, unknown>): Promise<void> {
    const eventType = String(payload.event || payload.Event || payload.type || payload.Type || 'Unknown');
    const lowerEvent = eventType.toLocaleLowerCase();
    if (['kick', 'ban', 'tempban', 'unban'].includes(lowerEvent)) {
        const target = String(payload.target || payload.Target || payload.player || payload.Player || 'Unknown');
        const staff = String(payload.staff || payload.Staff || payload.moderator || payload.Moderator || 'Unknown');
        await sendEmbed(client, CHANNEL_IDS.erlcPunishmentLog, baseEmbed('Confirmed ER:LC Punishment Event')
            .setDescription(`ER:LC delivered a signed **${eventType}** event through the configured official webhook.`)
            .addFields(
                { name: 'Staff Member', value: staff, inline: true },
                { name: 'Target', value: target, inline: true },
                { name: 'Action', value: eventType, inline: true },
                { name: 'Source', value: 'Signed ER:LC Event Webhook' },
            ));
        return;
    }

    if (eventType !== 'Unknown') {
        await sendEmbed(client, CHANNEL_IDS.erlcCommandLog, baseEmbed('ER:LC Signed Event Received').addFields(
            { name: 'Event Type', value: eventType.slice(0, 1024) },
            { name: 'Source', value: 'Signed ER:LC Event Webhook' },
        ));
    }
}

export function startWebhookServer(client: Client) {
    // Render/Railway expose PORT for web services; WEBHOOK_PORT can override it.
    const portSource = process.env.WEBHOOK_PORT || process.env.PORT || '3000';
    const configuredPort = Number(portSource);
    const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65_535
        ? configuredPort
        : 3000;
    if (port !== configuredPort) logger.warn('WEBHOOK_PORT or PORT is invalid; using port 3000.');
    const server = createServer(async (request, response) => {
        if (request.method === 'GET' && request.url === '/health') {
            respond(response, 200, {
                ok: true,
                service: 'discord-management-bot',
                uptime: Math.floor(process.uptime()),
                discord: client.isReady() ? 'connected' : 'connecting',
                database: isDatabaseAvailable(),
                timestamp: new Date().toISOString(),
            });
            return;
        }
        if (request.method !== 'POST' || !['/roblox-event', '/erlc-event'].includes(request.url || '')) {
            respond(response, 404, { ok: false, error: 'Not found' });
            return;
        }

        try {
            const rawBody = await readBody(request);
            if (request.url === '/erlc-event' && !verifyErlcSignature(request, rawBody)) {
                respond(response, 401, { ok: false, error: 'Invalid signature' });
                return;
            }
            const officialSignature = request.url === '/erlc-event'
                ? String(request.headers['x-signature-ed25519'])
                : null;
            if (officialSignature) {
                const now = Date.now();
                for (const [signature, processedAt] of processedSignatures) {
                    if (now - processedAt > SIGNATURE_REPLAY_WINDOW_MS) processedSignatures.delete(signature);
                }
                if (processedSignatures.has(officialSignature)) {
                    respond(response, 200, { ok: true, duplicate: true });
                    return;
                }
            }
            if (request.url === '/roblox-event') {
                const secret = process.env.WEBHOOK_SECRET;
                if (!secret || request.headers['x-webhook-secret'] !== secret) {
                    respond(response, 401, { ok: false, error: 'Unauthorized' });
                    return;
                }
            }

            const payload = JSON.parse(rawBody.toString('utf8')) as unknown;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
            if (request.url === '/erlc-event') await processOfficialErlcEvent(client, payload as Record<string, unknown>);
            else await processLegacyEvent(client, payload as Record<string, unknown>);
            if (officialSignature) processedSignatures.set(officialSignature, Date.now());
            respond(response, 200, { ok: true });
        } catch (error) {
            const tooLarge = error instanceof Error && error.message === 'Payload too large';
            const deliveryFailed = error instanceof WebhookDeliveryError;
            if (deliveryFailed) logger.warn(error.message);
            respond(
                response,
                tooLarge ? 413 : deliveryFailed ? 503 : 400,
                { ok: false, error: tooLarge ? 'Payload too large' : deliveryFailed ? 'Discord delivery unavailable' : 'Invalid request' },
            );
        }
    });

    server.on('error', error => logger.warn(`Webhook server unavailable: ${error.message}`));
    // Render requires public web services to listen on an externally reachable
    // interface. Binding explicitly avoids platform-specific IPv4/IPv6 ambiguity.
    server.listen(port, '0.0.0.0', () => logger.info(`Webhook server listening on 0.0.0.0:${port}.`));

    const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL || process.env.SELF_URL;
    if (externalUrl) {
        const healthUrl = `${externalUrl.replace(/\/+$/, '')}/health`;
        const requester = healthUrl.startsWith('https') ? httpsGet : httpGet;
        const pinger = setInterval(() => {
            requester(healthUrl, res => res.resume()).on('error', () => undefined);
        }, 5 * 60_000);
        pinger.unref?.();
        logger.info(`Keep-alive pinger enabled; will ping ${healthUrl} every 5 minutes.`);
    }
    return server;
}
