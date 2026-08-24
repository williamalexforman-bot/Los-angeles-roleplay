import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

type BannerInstall = {
    source: string;
    target: string;
    label: string;
};

const ASSETS_ROOT = resolve(__dirname, '..', '..', 'assets');

const BATCH_ONE_BANNERS: BannerInstall[] = [
    {
        source: resolve(ASSETS_ROOT, 'brand-banners', 'infraction.webp.b64'),
        target: resolve(ASSETS_ROOT, 'infraction-banner.png'),
        label: 'Infraction',
    },
    {
        source: resolve(ASSETS_ROOT, 'new-banners', 'underbanner.b64'),
        target: resolve(ASSETS_ROOT, 'underbanner.webp'),
        label: 'Underbanner',
    },
];

function installBanner({ source, target, label }: BannerInstall): boolean {
    try {
        if (!existsSync(source)) {
            logger.warn(`[Banners] ${label} source is missing: ${source}`);
            return false;
        }

        const encoded = readFileSync(source, 'utf8').trim();
        if (!encoded) {
            logger.warn(`[Banners] ${label} source is empty.`);
            return false;
        }

        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length) {
            logger.warn(`[Banners] ${label} source could not be decoded.`);
            return false;
        }

        writeFileSync(target, bytes);
        logger.info(`[Banners] Installed new ${label} artwork (${bytes.length.toLocaleString()} bytes).`);
        return true;
    } catch (error) {
        logger.warn(`[Banners] Failed to install ${label}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export function installBatchOneBannerAssets(): void {
    const installed = BATCH_ONE_BANNERS.filter(installBanner).length;
    logger.info(`[Banners] Batch 1 asset install complete (${installed}/${BATCH_ONE_BANNERS.length}).`);
}
