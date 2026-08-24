import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { logger } from '../utils/logger';

type BannerInstall = {
    sourceKeys: string[];
    targets: string[];
    label: string;
    width?: number;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');
const PACK_PATHS = [
    resolve(ASSETS_ROOT, 'brand-banner-pack-v3', 'part-000.txt'),
    resolve(ASSETS_ROOT, 'brand-banner-pack', 'part-000.txt'),
];

// Components V2 media galleries are rendered very wide on desktop. The source
// artwork in the consolidated pack is WebP, so writing those bytes straight to
// disk lets Discord upscale/compress them again and can make text look soft.
// We render a high-resolution runtime copy first instead.
const WIDE_BANNER_WIDTH = 1920;
const UNDERBANNER_WIDTH = 1920;

const FULL_BANNER_MAPPINGS: BannerInstall[] = [
    { sourceKeys: ['underbanner.webp'], targets: ['underbanner.webp'], label: 'Underbanner', width: UNDERBANNER_WIDTH },
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

async function renderForTarget(source: Buffer, target: string, width: number): Promise<Buffer> {
    let pipeline = sharp(source)
        .resize({
            width,
            fit: 'inside',
            withoutEnlargement: false,
            kernel: sharp.kernel.lanczos3,
        })
        // Light sharpening specifically helps small lettering survive Discord's
        // own display resampling without introducing harsh halos.
        .sharpen({ sigma: 0.65, m1: 0.7, m2: 1.2 });

    if (target.toLowerCase().endsWith('.png')) {
        pipeline = pipeline.png({ compressionLevel: 6, adaptiveFiltering: true });
    } else {
        pipeline = pipeline.webp({ quality: 100, nearLossless: true, smartSubsample: true });
    }
    return pipeline.toBuffer();
}

async function installFromPack(pack: Record<string, string>, mapping: BannerInstall): Promise<boolean> {
    const aliases = expandedKeys(mapping.sourceKeys);
    const sourceName = aliases.find(name => typeof pack[name] === 'string' && pack[name].trim());
    if (!sourceName) {
        logger.warn(`[Banners] ${mapping.label} source is missing from banner pack (${aliases.join(', ')}).`);
        return false;
    }

    try {
        const sourceBytes = Buffer.from(pack[sourceName].trim(), 'base64');
        if (!sourceBytes.length) throw new Error('decoded file is empty');
        const metadata = await sharp(sourceBytes).metadata();
        const outputWidth = Math.max(mapping.width || WIDE_BANNER_WIDTH, metadata.width || 0);

        for (const target of mapping.targets) {
            const rendered = await renderForTarget(sourceBytes, target, outputWidth);
            writeFileSync(resolve(ASSETS_ROOT, target), rendered);
            logger.info(`[Banners] Rendered ${mapping.label} ${metadata.width || '?'}x${metadata.height || '?'} -> ${outputWidth}px wide (${target}, ${rendered.length.toLocaleString()} bytes).`);
        }
        return true;
    } catch (error) {
        logger.warn(`[Banners] Failed to install ${mapping.label}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export async function installBatchOneBannerAssets(): Promise<void> {
    const pack = loadBannerPack();
    if (!Object.keys(pack).length) {
        logger.warn('[Banners] Full banner pack was not available; existing runtime artwork will be kept.');
        return;
    }

    const results = await Promise.all(FULL_BANNER_MAPPINGS.map(mapping => installFromPack(pack, mapping)));
    const installed = results.filter(Boolean).length;
    logger.info(`[Banners] High-resolution banner install complete (${installed}/${FULL_BANNER_MAPPINGS.length}).`);
}
