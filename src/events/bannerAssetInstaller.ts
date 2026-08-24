import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type BannerInstall = {
    sourceKeys: string[];
    targets: string[];
    label: string;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');
const PACK_PATHS = [
    resolve(ASSETS_ROOT, 'brand-banner-pack-v3', 'part-000.txt'),
    resolve(ASSETS_ROOT, 'brand-banner-pack', 'part-000.txt'),
];

const FULL_BANNER_MAPPINGS: BannerInstall[] = [
    { sourceKeys: ['underbanner.webp'], targets: ['underbanner.webp'], label: 'Underbanner' },
    { sourceKeys: ['infractions-banner.webp', 'infraction-banner.webp'], targets: ['infraction-banner.png'], label: 'Infractions' },
    { sourceKeys: ['promotions-banner.webp', 'promotion-banner.webp'], targets: ['promotion-banner.png'], label: 'Promotions' },
    { sourceKeys: ['partnership-banner.webp'], targets: ['partnership-banner.webp'], label: 'Partnership' },
    { sourceKeys: ['assistance-banner.webp', 'assistance-banner.png'], targets: ['assistance-banner.png'], label: 'Assistance' },
    { sourceKeys: ['suggestion-banner.webp', 'suggestions-banner.webp'], targets: ['suggestion-banner.webp'], label: 'Suggestions' },
    { sourceKeys: ['dashboard-banner.webp'], targets: ['dashboard-banner.webp'], label: 'Dashboard' },
    { sourceKeys: ['rules-banner.webp'], targets: ['rules-banner.webp'], label: 'Rules' },
    { sourceKeys: ['applications-banner.webp', 'applications-banner.png'], targets: ['applications-banner.png'], label: 'Applications' },
    { sourceKeys: ['training-results-banner.webp', 'training-result-banner.webp'], targets: ['training-results-banner.webp'], label: 'Training Results' },
    { sourceKeys: ['training-request-banner.webp'], targets: ['training-request-banner.webp'], label: 'Training Request' },
    { sourceKeys: ['paid-ad-banner.webp', 'paidad-banner.webp'], targets: ['paid-ad-banner.webp'], label: 'Paid Advertisement' },
    { sourceKeys: ['staff-feedback-banner.webp'], targets: ['staff-feedback-banner.webp'], label: 'Staff Feedback' },
];

function loadBannerPack(): Record<string, string> {
    for (const packPath of PACK_PATHS) {
        try {
            if (!existsSync(packPath)) continue;
            const parsed = JSON.parse(readFileSync(packPath, 'utf8')) as Record<string, string>;
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed;
        } catch (error) {
            logger.warn(`[Banners] Could not parse ${packPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {};
}

function expandedKeys(keys: readonly string[]): string[] {
    const aliases = new Set<string>();
    for (const key of keys) {
        aliases.add(key);
        if (key.endsWith('.webp')) aliases.add(key.replace('.webp', '.png'));
        if (key.endsWith('.png')) aliases.add(key.replace('.png', '.webp'));
    }
    return [...aliases];
}

function installFromPack(pack: Record<string, string>, mapping: BannerInstall): boolean {
    const aliases = expandedKeys(mapping.sourceKeys);
    const sourceName = aliases.find(name => typeof pack[name] === 'string' && pack[name].trim());
    if (!sourceName) {
        logger.warn(`[Banners] ${mapping.label} source is missing from banner pack (${aliases.join(', ')}).`);
        return false;
    }
    try {
        const bytes = Buffer.from(pack[sourceName].trim(), 'base64');
        if (!bytes.length) throw new Error('decoded file is empty');
        for (const target of mapping.targets) writeFileSync(resolve(ASSETS_ROOT, target), bytes);
        logger.info(`[Banners] Installed ${mapping.label} artwork from ${sourceName} (${bytes.length.toLocaleString()} bytes).`);
        return true;
    } catch (error) {
        logger.warn(`[Banners] Failed to install ${mapping.label}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export function installBatchOneBannerAssets(): void {
    const pack = loadBannerPack();
    if (!Object.keys(pack).length) {
        logger.warn('[Banners] Full banner pack was not available; existing runtime artwork will be kept.');
        return;
    }
    const installed = FULL_BANNER_MAPPINGS.filter(mapping => installFromPack(pack, mapping)).length;
    logger.info(`[Banners] Full banner install complete (${installed}/${FULL_BANNER_MAPPINGS.length}).`);
}
