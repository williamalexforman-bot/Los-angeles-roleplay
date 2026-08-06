import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants';

/* -------------------------------------------------------------------------- */
/*  Image URL constants (replace 'YOUR_URL' with your hosted image URLs)      */
/*                                                                            */
/*  TOP_BANNER_*  -> Wide main header banners for each session type           */
/*                   (giant bold white title + "most immersive Los Angeles    */
/*                   experience" subtext over a blurred ERLC vehicle grid).   */
/*  BOTTOM_UNDERBANNER -> Thin wide bar: bold italic "LOS ANGELES ROLEPLAY"   */
/*                   over a dark blurred vehicle background. Sits at the VERY */
/*                   BOTTOM as its own separate embed.                        */
/* -------------------------------------------------------------------------- */

export const TOP_BANNER_START = 'YOUR_URL';
export const TOP_BANNER_END = 'YOUR_URL';
export const TOP_BANNER_VOTE = 'YOUR_URL';
export const TOP_BANNER_BOOST = 'YOUR_URL';
export const TOP_BANNER_FULL = 'YOUR_URL';
export const BOTTOM_UNDERBANNER = 'YOUR_URL';

export const SESSION_BACKGROUND_NAME = 'los_angeles_roleplay_4.webp';
export const SESSION_BACKGROUND_PATH = path.resolve(process.cwd(), 'assets', SESSION_BACKGROUND_NAME);
export const SESSION_BACKGROUND_URL = `attachment://${SESSION_BACKGROUND_NAME}`;
export const SESSION_UNDERBANNER_NAME = 'underbanner.webp';
export const SESSION_UNDERBANNER_PATH = path.resolve(process.cwd(), 'assets', SESSION_UNDERBANNER_NAME);

/**
 * Map a session type to its TOP image URL constant.
 * Defaults to fall back to the local background attachment if a constant has
 * not been set to a real hosted URL yet.
 */
export function resolveTopBannerUrl(emblemType: SessionEmblemType): string {
    switch (emblemType) {
        case 'start': return TOP_BANNER_START;
        case 'end': return TOP_BANNER_END;
        case 'vote': return TOP_BANNER_VOTE;
        case 'boost': return TOP_BANNER_BOOST;
        case 'full': return TOP_BANNER_FULL;
        default: return TOP_BANNER_START;
    }
}

export type SessionEmblemType = 'start' | 'end' | 'full' | 'boost' | 'vote';

const SESSION_EMBLEM_CANDIDATES: Record<SessionEmblemType, string[]> = {
    start: ['session-start-banner.png', 'session-start.png', 'session start'],
    end: ['session-end-banner.png', 'session-end.png', 'session end'],
    full: ['session-full-banner.png', 'session-full.png', 'session full'],
    boost: ['session-boost-banner.png', 'session-boost.png', 'session boost'],
    vote: ['session-vote-banner.png', 'session-vote.png', 'Session vote', 'Copy of Dashboard (9).png'],
};

function assetExists(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

function resolveSessionEmblem(emblemType: SessionEmblemType): { path: string; name: string } | undefined {
    for (const filename of SESSION_EMBLEM_CANDIDATES[emblemType]) {
        const resolvedPath = path.resolve(process.cwd(), 'assets', filename);
        if (assetExists(resolvedPath)) {
            return { path: resolvedPath, name: filename };
        }
    }
    return undefined;
}

export const SESSION_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();
};

/**
 * Top embed (main banner). Uses the provided top-banner URL via .setImage().
 * NO .setThumbnail() is used. Footer is text-only.
 */
export const createSessionEmbed = (
    title: string,
    description: string,
    color: ColorResolvable = BRAND.color,
    emblemType: SessionEmblemType = 'start',
) => {
    const bannerUrl = resolveTopBannerUrl(emblemType);
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setImage(bannerUrl)
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();

    // Fallback: if a hosted URL hasn't been configured yet, use the local
    // expanded banner asset as an attachment so the embed still displays.
    if (bannerUrl === 'YOUR_URL') {
        const emblem = resolveSessionEmblem(emblemType);
        if (emblem) {
            embed.setImage(`attachment://${emblem.name}`);
        } else if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
            embed.setImage(SESSION_BACKGROUND_URL);
        }
    }

    return embed;
};

/**
 * Bottom embed (underbanner). A bare image-only embed that sits strictly at
 * the very bottom of the message, below all fields/buttons. Uses
 * BOTTOM_UNDERBANNER via .setImage().
 */
export const createUnderbannerEmbed = (color: ColorResolvable = BRAND.color) => {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setImage(BOTTOM_UNDERBANNER);

    // Fallback: if the hosted URL isn't configured, render the local
    // underbanner.webp as an attachment bar.
    if (BOTTOM_UNDERBANNER === 'YOUR_URL') {
        embed.setImage(`attachment://${SESSION_UNDERBANNER_NAME}`);
    }

    return embed;
};

export const createSessionAttachments = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder[] => {
    const attachments: AttachmentBuilder[] = [];

    // Only attach local assets while the banner constants still use
    // 'YOUR_URL'. Once real hosted URLs are configured, no files are needed.
    if (resolveTopBannerUrl(emblemType) === 'YOUR_URL') {
        const emblem = resolveSessionEmblem(emblemType);
        if (emblem) {
            attachments.push(new AttachmentBuilder(emblem.path, { name: emblem.name }));
        } else if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
            attachments.push(new AttachmentBuilder(SESSION_BACKGROUND_PATH, { name: SESSION_BACKGROUND_NAME }));
        }
    }

    if (BOTTOM_UNDERBANNER === 'YOUR_URL' && assetExists(SESSION_UNDERBANNER_PATH)) {
        attachments.push(new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: SESSION_UNDERBANNER_NAME }));
    }

    return attachments;
};

export const createBrandedEmbed = (title?: string, description?: string, color = BRAND.color) => {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    return embed;
};

export const createLogoAttachment = () => new AttachmentBuilder(BRAND.logoPath, { name: BRAND.logoName });

export const createSessionAttachment = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder | undefined => {
    const emblem = resolveSessionEmblem(emblemType);
    if (emblem) {
        return new AttachmentBuilder(emblem.path, { name: emblem.name });
    }
    if (assetExists(SESSION_BACKGROUND_PATH)) {
        return new AttachmentBuilder(SESSION_BACKGROUND_PATH, { name: SESSION_BACKGROUND_NAME });
    }
    return undefined;
};

export const createErrorEmbed = (errorMessage: string) => {
    return createEmbed('Error', errorMessage);
};

export const createSuccessEmbed = (successMessage: string) => {
    return createEmbed('Success', successMessage);
};

export const createInfoEmbed = (infoMessage: string) => {
    return createEmbed('Information', infoMessage);
};

export const sendEmbed = async (interaction: ChatInputCommandInteraction, message: string) => {
    const embed = createEmbed('Bot Update', message);

    if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ embeds: [embed], files: [createLogoAttachment()] });
    }

    return interaction.reply({ embeds: [embed], files: [createLogoAttachment()], ephemeral: true });
};
