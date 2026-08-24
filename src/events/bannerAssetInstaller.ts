import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type BannerInstall = {
    sourceKey: string;
    targets: string[];
    label: string;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');
const PACK_PATHS = [
    resolve(ASSETS_ROOT, 'brand-banner-pack-v3', 'part-000.txt'),
    resolve(ASSETS_ROOT, 'brand-banner-pack', 'part-000.txt'),
];

const FULL_BANNER_MAPPINGS: BannerInstall[] = [
    { sourceKey: 'underbanner.webp', targets: ['underbanner.webp'], label: 'Underbanner' },
    { sourceKey: 'infractions-banner.webp', targets: ['infraction-banner.png'], label: 'Infractions' },
    { sourceKey: 'promotions-banner.webp', targets: ['promotion-banner.png'], label: 'Promotions' },
    { sourceKey: 'partnership-banner.webp', targets: ['partnership-banner.webp'], label: 'Partnership' },
    { sourceKey: 'assistance-banner.webp', targets: ['assistance-banner.png'], label: 'Assistance' },
    { sourceKey: 'suggestion-banner.webp', targets: ['suggestion-banner.webp'], label: 'Suggestions' },
    { sourceKey: 'dashboard-banner.webp', targets: ['dashboard-banner.webp'], label: 'Dashboard' },
    { sourceKey: 'rules-banner.webp', targets: ['rules-banner.webp'], label: 'Rules' },
    { sourceKey: 'applications-banner.webp', targets: ['applications-banner.png'], label: 'Applications' },
    { sourceKey: 'training-results-banner.webp', targets: ['training-results-banner.webp'], label: 'Training Results' },
    { sourceKey: 'training-request-banner.webp', targets: ['training-request-banner.webp'], label: 'Training Request' },
    { sourceKey: 'paid-ad-banner.webp', targets: ['paid-ad-banner.webp'], label: 'Paid Advertisement' },
    { sourceKey: 'staff-feedback-banner.webp', targets: ['staff-feedback-banner.webp'], label: 'Staff Feedback' },
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

function sourceAliases(sourceKey: string): string[] {
    const aliases = new Set<string>([sourceKey]);
    if (sourceKey.includes('infractions')) aliases.add(sourceKey.replace('infractions', 'infraction'));
    if (sourceKey.includes('promotions')) aliases.add(sourceKey.replace('promotions', 'promotion'));
    if (sourceKey.includes('suggestion')) aliases.add(sourceKey.replace('suggestion', 'suggestions'));
    if (sourceKey.endsWith('.webp')) aliases.add(sourceKey.replace('.webp', '.png'));
    return [...aliases];
}

function installFromPack(pack: Record<string, string>, mapping: BannerInstall): boolean {
    const sourceName = sourceAliases(mapping.sourceKey).find(name => typeof pack[name] === 'string' && pack[name].trim());
    if (!sourceName) {
        logger.warn(`[Banners] ${mapping.label} source is missing from banner pack (${sourceAliases(mapping.sourceKey).join(', ')}).`);
        return false;
    }
    try {
        const bytes = Buffer.from(pack[sourceName].trim(), 'base64');
        if (!bytes.length) throw new Error('decoded file is empty');
        for (const target of mapping.targets) writeFileSync(resolve(ASSETS_ROOT, target), bytes);
        logger.info(`[Banners] Installed ${mapping.label} artwork (${bytes.length.toLocaleString()} bytes).`);
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
