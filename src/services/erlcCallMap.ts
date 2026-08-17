import sharp from 'sharp';
import { logger } from '../utils/logger';

const OFFICIAL_POSTAL_MAP_URL = 'https://api.erlc.gg/maps/fall_postals.png';
const OFFICIAL_MAP_SIZE = 3121;
const OFFICIAL_MAP_CENTER = (OFFICIAL_MAP_SIZE - 1) / 2;
const MAP_CACHE_MS = 30 * 60 * 1000;

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
        cachedMap = { buffer, loadedAt: Date.now() };
        return buffer;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * ER:LC documents 0,0 as the center of its 3121x3121 official map image,
 * with +X moving right and +Z moving down. Convert directly into map pixels,
 * then crop a dispatch-style view around the call and draw a location pin.
 */
export async function renderErlcCallMap(
    x: number,
    z: number,
    callNumber: number,
    locationLabel: string,
): Promise<RenderedErlcCallMap | null> {
    try {
        const source = await fetchOfficialMap();
        const image = sharp(source, { failOn: 'none' });
        const metadata = await image.metadata();
        const width = metadata.width ?? OFFICIAL_MAP_SIZE;
        const height = metadata.height ?? OFFICIAL_MAP_SIZE;

        const scaleX = width / OFFICIAL_MAP_SIZE;
        const scaleY = height / OFFICIAL_MAP_SIZE;
        const pixelX = clamp((OFFICIAL_MAP_CENTER + x) * scaleX, 0, width - 1);
        const pixelY = clamp((OFFICIAL_MAP_CENTER + z) * scaleY, 0, height - 1);

        // Roughly the same wide, zoomed dispatch-map framing as the reference panel.
        const cropWidth = Math.min(width, Math.max(900, Math.round(1500 * scaleX)));
        const cropHeight = Math.min(height, Math.max(560, Math.round(900 * scaleY)));
        const left = Math.round(clamp(pixelX - cropWidth / 2, 0, width - cropWidth));
        const top = Math.round(clamp(pixelY - cropHeight / 2, 0, height - cropHeight));
        const markerX = pixelX - left;
        const markerY = pixelY - top;

        const markerWidth = Math.max(74, Math.round(92 * scaleX));
        const markerHeight = Math.max(96, Math.round(118 * scaleY));
        const ringSize = Math.max(42, Math.round(54 * scaleX));
        const label = escapeXml(locationLabel || `Call #${callNumber}`);
        const markerSvg = Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" width="${markerWidth}" height="${markerHeight}">
                <defs>
                    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
                        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.55"/>
                    </filter>
                </defs>
                <g filter="url(#shadow)">
                    <path d="M ${markerWidth / 2} ${markerHeight - 4}
                             C ${markerWidth / 2 - 7} ${markerHeight - 20}, 10 ${markerHeight * 0.56}, 10 ${markerHeight * 0.34}
                             C 10 ${markerHeight * 0.12}, ${markerWidth * 0.27} 5, ${markerWidth / 2} 5
                             C ${markerWidth * 0.73} 5, ${markerWidth - 10} ${markerHeight * 0.12}, ${markerWidth - 10} ${markerHeight * 0.34}
                             C ${markerWidth - 10} ${markerHeight * 0.56}, ${markerWidth / 2 + 7} ${markerHeight - 20}, ${markerWidth / 2} ${markerHeight - 4} Z"
                          fill="#ef4444" stroke="#ffffff" stroke-width="5"/>
                    <circle cx="${markerWidth / 2}" cy="${markerHeight * 0.34}" r="${ringSize / 4}" fill="#ffffff"/>
                    <circle cx="${markerWidth / 2}" cy="${markerHeight * 0.34}" r="${ringSize / 8}" fill="#ef4444"/>
                </g>
            </svg>
        `);

        // Add a dark call label above the marker so the image reads like a dispatch map.
        const labelWidth = Math.min(cropWidth - 30, Math.max(220, Math.round(460 * scaleX)));
        const labelHeight = Math.max(58, Math.round(70 * scaleY));
        const safeLabel = label.length > 46 ? `${label.slice(0, 45)}…` : label;
        const labelSvg = Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${labelHeight}">
                <rect x="2" y="2" width="${labelWidth - 4}" height="${labelHeight - 4}" rx="18" fill="#202124" fill-opacity="0.94" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
                <text x="${labelWidth / 2}" y="${labelHeight * 0.62}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(24, Math.round(30 * scaleX))}" font-weight="700" fill="#ffffff">${safeLabel}</text>
            </svg>
        `);

        const markerLeft = Math.round(clamp(markerX - markerWidth / 2, 0, cropWidth - markerWidth));
        const markerTop = Math.round(clamp(markerY - markerHeight + 8, 0, cropHeight - markerHeight));
        const labelLeft = Math.round(clamp(markerX - labelWidth / 2, 0, cropWidth - labelWidth));
        const labelTop = Math.round(clamp(markerTop - labelHeight - 10, 0, cropHeight - labelHeight));

        const output = await sharp(source, { failOn: 'none' })
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .composite([
                { input: markerSvg, left: markerLeft, top: markerTop },
                { input: labelSvg, left: labelLeft, top: labelTop },
            ])
            .resize({ width: 1200, height: 720, fit: 'fill' })
            .png({ compressionLevel: 8 })
            .toBuffer();

        return {
            buffer: output,
            filename: `erlc-911-map-${callNumber}.png`,
        };
    } catch (error) {
        logger.warn(`[911 Map] Could not render official ER:LC map: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}
