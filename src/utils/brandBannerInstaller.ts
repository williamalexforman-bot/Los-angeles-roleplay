import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceDir = resolve(process.cwd(), 'assets', 'brand-banners');
const assetDir = resolve(process.cwd(), 'assets');

const mappings = [
    { source: 'infraction.webp.b64', target: 'infraction-banner.png' },
    { source: 'promotion.webp.b64', target: 'promotion-banner.png' },
    { source: 'partnership.webp.b64', target: 'partnership-banner.webp' },
    { source: 'underbanner.webp.b64', target: 'underbanner.webp' },
] as const;

for (const mapping of mappings) {
    try {
        const sourcePath = resolve(sourceDir, mapping.source);
        if (!existsSync(sourcePath)) continue;
        const encoded = readFileSync(sourcePath, 'utf8').trim();
        if (!encoded) continue;
        writeFileSync(resolve(assetDir, mapping.target), Buffer.from(encoded, 'base64'));
    } catch (error) {
        console.warn(`[Brand Banners] Could not install ${mapping.target}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
