import sharp from 'sharp';
import { logger } from '../utils/logger';

const OFFICIAL_POSTAL_MAP_URL = 'https://api.erlc.gg/maps/fall_postals.png';
const OFFICIAL_MAP_SIZE = 3121;
const OFFICIAL_MAP_CENTER = (OFFICIAL_MAP_SIZE - 1) / 2;
const MAP_CACHE_MS = 30 * 60 * 1000;
const OUTPUT_SIZE = 1200;

let cachedMap: { buffer: Buffer; loadedAt: number } | null = null;

export interface RenderedErlcCallMap {
    buffer: Buffer;
    filename: string;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function fetchOfficialMap(): Promise<Buffer> {
    if (cachedMap && Date.now() - cachedMap.loadedAt < MAP_CACHE_MS) return cachedMap.buffer;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(OFFICIAL_POSTAL_MAP_URL, {
            headers: { Accept: 'image/png,image/*;q=0.8' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 10_000) throw new Error('Official map response was unexpectedly small.');
        cachedMap = { buffer, loadedAt: Date.now() };
        return buffer;
    } finally {
        clearTimeout(timeout);
    }
}

function callLabelSvg(callNumber: number, locationLabel: string): Buffer {
    const label = escapeXml((locationLabel || `911 Call #${callNumber}`).slice(0, 70));
    return Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="1100" height="86">
            <rect x="0" y="0" width="1100" height="86" rx="18" fill="#202124" fill-opacity="0.94"/>
            <text x="550" y="35" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">911 Call #${callNumber}</text>
            <text x="550" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#ffffff">${label}</text>
        </svg>
    `);
}

function markerSvg(): Buffer {
    return Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="74" height="96">
            <path d="M37 92 C30 78 8 55 8 34 C8 15 20 5 37 5 C54 5 66 15 66 34 C66 55 44 78 37 92 Z"
                  fill="#ef4444" stroke="#ffffff" stroke-width="5"/>
            <circle cx="37" cy="34" r="12" fill="#ffffff"/>
            <circle cx="37" cy="34" r="6" fill="#ef4444"/>
        </svg>
    `);
}

/**
 * Always returns the actual official ER:LC postal map as a Discord attachment.
 *
 * ER:LC documents that the map image is 3121x3121, with 0,0 at its centre,
 * +X to the right and +Z downward. The documentation does not promise that
 * every world-unit value is a 1:1 image pixel, so we never crop the image based
 * on an unverified scale. When the raw coordinate safely fits the documented
 * image bounds we draw a marker; otherwise the full postal map still displays
 * with the exact ER:LC location label above it instead of producing a blank crop.
 */
export async function renderErlcCallMap(
    x: number,
    z: number,
    callNumber: number,
    locationLabel: string,
): Promise<RenderedErlcCallMap | null> {
    let source: Buffer;
    try {
        source = await fetchOfficialMap();
    } catch (error) {
        logger.warn(`[911 Map] Could not download official ER:LC map: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }

    try {
        const metadata = await sharp(source, { failOn: 'none' }).metadata();
        const width = metadata.width ?? OFFICIAL_MAP_SIZE;
        const height = metadata.height ?? OFFICIAL_MAP_SIZE;
        const scaleX = width / OFFICIAL_MAP_SIZE;
        const scaleY = height / OFFICIAL_MAP_SIZE;
        const overlays: Array<{ input: Buffer; left: number; top: number }> = [
            { input: callLabelSvg(callNumber, locationLabel), left: Math.max(10, Math.round((width - 1100) / 2)), top: 24 },
        ];

        const candidateX = OFFICIAL_MAP_CENTER + x;
        const candidateY = OFFICIAL_MAP_CENTER + z;
        if (Number.isFinite(candidateX)
            && Number.isFinite(candidateY)
            && candidateX >= 0
            && candidateX < OFFICIAL_MAP_SIZE
            && candidateY >= 0
            && candidateY < OFFICIAL_MAP_SIZE) {
            const pixelX = candidateX * scaleX;
            const pixelY = candidateY * scaleY;
            overlays.push({
                input: markerSvg(),
                left: Math.round(clamp(pixelX - 37, 0, Math.max(0, width - 74))),
                top: Math.round(clamp(pixelY - 92, 0, Math.max(0, height - 96))),
            });
        }

        const output = await sharp(source, { failOn: 'none' })
            .composite(overlays)
            .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: 'contain' })
            .png({ compressionLevel: 8, palette: true, quality: 90 })
            .toBuffer();

        return {
            buffer: output,
            filename: `erlc-911-map-${callNumber}.png`,
        };
    } catch (error) {
        logger.warn(`[911 Map] Marker rendering failed; using full official map: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
            buffer: source,
            filename: `erlc-911-map-${callNumber}.png`,
        };
    }
}
