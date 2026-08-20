import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Partnership, Paid Ad, and Activity Check panels now attach their artwork
 * directly in the original Components V2 send. Keeping the old post-send
 * injector active caused duplicate headers and could race Discord attachment
 * processing, which made some images disappear. Leave this hook as a no-op so
 * older startup code can call it safely without editing messages after send.
 */
export function installBannerInjector(_client: Client): void {
    logger.info('[BannerInjector] Disabled: V2 panels now attach banners directly.');
}
