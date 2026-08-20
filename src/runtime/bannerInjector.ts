import type { Client } from 'discord.js';
import * as quotaModule from '../commands/messageQuota';
import { logger } from '../utils/logger';
import { installQuotaRuntimeRepair } from './quotaRuntimeRepair';

/**
 * Partnership, Paid Ad, and Activity Check panels now attach their artwork
 * directly in the original Components V2 send. Keeping the old post-send
 * injector active caused duplicate headers and could race Discord attachment
 * processing, which made some images disappear.
 *
 * This hook is still loaded immediately on ClientReady, so it is also the
 * safest early place to install the quota runtime repair. Quota tracking then
 * starts independently of the larger slash-command/onReady chain.
 */
export function installBannerInjector(client: Client): void {
    installQuotaRuntimeRepair(quotaModule, client);
    logger.info('[BannerInjector] Disabled: V2 panels attach banners directly. Early quota runtime repair installed.');
}
