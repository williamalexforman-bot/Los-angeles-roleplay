import type { Client } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Banners are attached directly by their feature modules.
 * This startup hook must remain dependency-free so an optional feature can
 * never prevent Discord, tickets, or slash commands from coming online.
 */
export function installBannerInjector(_client: Client): void {
    logger.info('[BannerInjector] Disabled: V2 panels attach banners directly.');
}
