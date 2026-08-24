import { statSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { logger } from '../utils/logger';

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');

const REQUIRED_ARTWORK = [
    ['larp-logo.png', 'LARP logo'],
    ['underbanner.png', 'Underbanner', 1118, 40],
    ['los-angeles-banner.png', 'Generic Los Angeles', 1600, 479],
    ['promotion-banner.png', 'Promotions', 1600, 479],
    ['partnership-banner.png', 'Partnership', 1600, 479],
    ['assistance-banner.png', 'Assistance / Tickets', 1600, 479],
    ['suggestion-banner.png', 'Suggestions', 1600, 479],
    ['dashboard-banner.png', 'Dashboard', 1600, 479],
    ['rules-banner.png', 'Rules', 1600, 479],
    ['applications-banner.png', 'Applications', 1600, 479],
    ['training-results-banner.png', 'Training Results', 1600, 479],
    ['training-request-banner.png', 'Training Request', 1600, 479],
    ['paid-ad-banner.png', 'Paid Advertisement', 1600, 479],
    ['staff-feedback-banner.png', 'Staff Feedback', 1600, 479],
    ['session-start-banner.png', 'Session Start', 1600, 479],
    ['session-end-banner.png', 'Session End', 1600, 479],
    ['session-vote-banner.png', 'Session Vote', 1600, 479],
    ['session-boost-banner.png', 'Session Boost', 1600, 479],
] as const;

function isUsable(filePath: string): boolean {
    try {
        const stats = statSync(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

export async function installBatchOneBannerAssets(): Promise<void> {
    const missing = REQUIRED_ARTWORK
        .filter(([filename]) => !isUsable(resolve(ASSETS_ROOT, filename)))
        .map(([, label]) => label);

    if (missing.length) {
        throw new Error(`Missing required standalone banner artwork: ${missing.join(', ')}`);
    }

    const lowResolution: string[] = [];
    for (const [filename, label, expectedWidth, expectedHeight] of REQUIRED_ARTWORK) {
        if (!expectedWidth || !expectedHeight) continue;
        const metadata = await sharp(resolve(ASSETS_ROOT, filename)).metadata();
        if (metadata.format !== 'png'
            || metadata.width !== expectedWidth
            || metadata.height !== expectedHeight) {
            lowResolution.push(
                `${label} (${metadata.width || '?'}x${metadata.height || '?'} ${metadata.format || 'unknown'})`,
            );
        }
    }
    if (lowResolution.length) {
        throw new Error(`Low-resolution or substituted banner artwork detected: ${lowResolution.join(', ')}`);
    }

    logger.info(`[Banners] Verified ${REQUIRED_ARTWORK.length} standalone assets, including the original high-resolution banner set.`);
}
