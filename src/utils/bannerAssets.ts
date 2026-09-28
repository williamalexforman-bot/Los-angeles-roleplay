import path from 'path';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants';

export const BANNERS = {
    infraction: 'infraction-banner.webp',
    promotion: 'promotion-banner.webp',
    assistance: 'support-banner.webp',
    dashboard: 'dashboard-banner.webp',
    session: 'session-banner.webp',
    verification: 'verification-banner.webp',
    regulations: 'regulations-banner.webp',
    applications: 'applications-banner.webp',
    staffGuide: 'staff-guide-banner.webp',
    paidAd: 'paid-ad-banner.webp',
    giveaway: 'giveaway-banner.webp',
    partnership: 'partnership-banner.webp',
    passed: 'accepted-banner.webp',
    denied: 'denied-banner.webp',
    underbanner: 'underbanner.webp',
} as const;

export type BannerKey = keyof typeof BANNERS;

export function bannerUrl(key: BannerKey): string {
    return `attachment://${BANNERS[key]}`;
}

export function bannerAttachment(key: BannerKey): AttachmentBuilder {
    const name = BANNERS[key];
    return new AttachmentBuilder(path.resolve(process.cwd(), 'assets', name), { name });
}

export function bannerFiles(key: Exclude<BannerKey, 'underbanner'>): AttachmentBuilder[] {
    return [bannerAttachment(key), bannerAttachment('underbanner')];
}

export function underbannerEmbed(): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.color).setImage(bannerUrl('underbanner'));
}
