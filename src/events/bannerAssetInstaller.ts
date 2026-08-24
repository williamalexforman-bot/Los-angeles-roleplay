import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type EncodedFallback = {
    source: string;
    target: string;
    label: string;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');

// The old consolidated JSON banner packs were truncated in Git and could not
// be parsed on Render. Banner installation now uses only real standalone files
// plus the few complete .b64 fallbacks that already exist in the repository.
const ENCODED_FALLBACKS: readonly EncodedFallback[] = [
    { source: 'dashboard-banner.b64', target: 'dashboard-banner.webp', label: 'Dashboard' },
    { source: 'partnership-banner.b64', target: 'partnership-banner.webp', label: 'Partnership' },
    { source: 'brand-banners/underbanner.webp.b64', target: 'underbanner.webp', label: 'Underbanner' },
];

const REQUIRED_ARTWORK = [
    ['underbanner.webp', 'Underbanner'],
    ['infraction-banner.png', 'Infractions'],
    ['promotion-banner.png', 'Promotions'],
    ['partnership-banner.webp', 'Partnership'],
    ['assistance-banner.png', 'Assistance / Tickets'],
    ['suggestion-banner.webp', 'Suggestions'],
    ['dashboard-banner.webp', 'Dashboard'],
    ['rules-banner.webp', 'Rules'],
    ['applications-banner.png', 'Applications'],
    ['training-results-banner.webp', 'Training Results'],
    ['training-request-banner.webp', 'Training Request'],
    ['paid-ad-banner.webp', 'Paid Advertisement'],
    ['staff-feedback-banner.webp', 'Staff Feedback'],
] as const;

function isUsable(filePath: string): boolean {
    try {
        const stats = statSync(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

function restoreEncodedFallback(asset: EncodedFallback): boolean {
    const targetPath = resolve(ASSETS_ROOT, asset.target);
    if (isUsable(targetPath)) return true;

    const sourcePath = resolve(ASSETS_ROOT, asset.source);
    if (!existsSync(sourcePath)) return false;

    try {
        const encoded = readFileSync(sourcePath, 'utf8').replace(/\s+/g, '');
        if (!encoded) return false;
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length) return false;
        writeFileSync(targetPath, bytes);
        logger.info(`[Banners] Restored ${asset.label} from standalone encoded source (${asset.target}, ${bytes.length.toLocaleString()} bytes).`);
        return true;
    } catch (error) {
        logger.warn(`[Banners] Could not restore ${asset.label}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export async function installBatchOneBannerAssets(): Promise<void> {
    for (const asset of ENCODED_FALLBACKS) restoreEncodedFallback(asset);

    const missing = REQUIRED_ARTWORK
        .filter(([filename]) => !isUsable(resolve(ASSETS_ROOT, filename)))
        .map(([, label]) => label);

    if (missing.length) {
        logger.warn(`[Banners] Missing exact standalone upper banner artwork: ${missing.join(', ')}. The bot will keep running; those optional top banners must be re-added as real asset files.`);
        return;
    }

    logger.info('[Banners] All standalone banner assets verified. Legacy truncated JSON banner packs are no longer used.');
}
