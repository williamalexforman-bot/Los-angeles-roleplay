import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type BannerInstall = {
    source: string;
    target: string;
    label: string;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');
const BRAND_ROOT = resolve(ASSETS_ROOT, 'brand-banners');

const BANNER_INSTALLS: BannerInstall[] = [
    { source: resolve(BRAND_ROOT, 'infraction.webp.b64'), target: resolve(ASSETS_ROOT, 'infraction-banner.png'), label: 'Infraction' },
    { source: resolve(BRAND_ROOT, 'promotion.webp.b64'), target: resolve(ASSETS_ROOT, 'promotion-banner.png'), label: 'Promotion' },
    { source: resolve(BRAND_ROOT, 'partnership.webp.b64'), target: resolve(ASSETS_ROOT, 'partnership-banner.webp'), label: 'Partnership' },
    { source: resolve(BRAND_ROOT, 'assistance.webp.b64'), target: resolve(ASSETS_ROOT, 'assistance-banner.png'), label: 'Assistance' },
    { source: resolve(BRAND_ROOT, 'suggestion.webp.b64'), target: resolve(ASSETS_ROOT, 'suggestion-banner.webp'), label: 'Suggestion' },
    { source: resolve(BRAND_ROOT, 'dashboard.webp.b64'), target: resolve(ASSETS_ROOT, 'dashboard-banner.webp'), label: 'Dashboard' },
    { source: resolve(BRAND_ROOT, 'rules.webp.b64'), target: resolve(ASSETS_ROOT, 'rules-banner.webp'), label: 'Rules' },
    { source: resolve(BRAND_ROOT, 'applications.webp.b64'), target: resolve(ASSETS_ROOT, 'applications-banner.png'), label: 'Applications' },
    { source: resolve(BRAND_ROOT, 'training-results.webp.b64'), target: resolve(ASSETS_ROOT, 'training-results-banner.webp'), label: 'Training Results' },
    { source: resolve(BRAND_ROOT, 'training-request.webp.b64'), target: resolve(ASSETS_ROOT, 'training-request-banner.webp'), label: 'Training Request' },
    { source: resolve(BRAND_ROOT, 'paid-ad.webp.b64'), target: resolve(ASSETS_ROOT, 'paid-ad-banner.webp'), label: 'Paid Ad' },
    { source: resolve(BRAND_ROOT, 'staff-feedback.webp.b64'), target: resolve(ASSETS_ROOT, 'staff-feedback-banner.webp'), label: 'Staff Feedback' },
    { source: resolve(BRAND_ROOT, 'underbanner.webp.b64'), target: resolve(ASSETS_ROOT, 'underbanner.webp'), label: 'Underbanner' },
];

function installBanner({ source, target, label }: BannerInstall): boolean {
    try {
        if (!existsSync(source)) {
            logger.warn(`[Banners] ${label} source is missing: ${source}`);
            return false;
        }
        const encoded = readFileSync(source, 'utf8').trim();
        if (!encoded) return false;
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length) return false;
        writeFileSync(target, bytes);
        logger.info(`[Banners] Installed ${label} artwork (${bytes.length.toLocaleString()} bytes).`);
        return true;
    } catch (error) {
        logger.warn(`[Banners] Failed to install ${label}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export function installBatchOneBannerAssets(): void {
    const installed = BANNER_INSTALLS.filter(installBanner).length;
    logger.info(`[Banners] Full asset install complete (${installed}/${BANNER_INSTALLS.length}).`);
}
