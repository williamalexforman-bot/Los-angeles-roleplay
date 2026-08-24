import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AttachmentBuilder } from 'discord.js';

export type BrandBannerKey = 'infraction' | 'promotion' | 'partnership' | 'underbanner';

const BANNER_FILES: Record<BrandBannerKey, string> = {
    infraction: 'infraction.webp.b64',
    promotion: 'promotion.webp.b64',
    partnership: 'partnership.webp.b64',
    underbanner: 'underbanner.webp.b64',
};

const cache = new Map<BrandBannerKey, Buffer>();

export function brandBannerBuffer(key: BrandBannerKey): Buffer {
    const cached = cache.get(key);
    if (cached) return cached;

    const filePath = resolve(process.cwd(), 'assets', 'brand-banners', BANNER_FILES[key]);
    const encoded = readFileSync(filePath, 'utf8').trim();
    const decoded = Buffer.from(encoded, 'base64');
    cache.set(key, decoded);
    return decoded;
}

export function brandBannerAttachment(key: BrandBannerKey, name: string): AttachmentBuilder {
    return new AttachmentBuilder(brandBannerBuffer(key), { name });
}
