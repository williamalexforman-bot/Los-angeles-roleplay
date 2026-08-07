import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants';

/* -------------------------------------------------------------------------- */
/*  Image URL constants.                                                      */
/*                                                                            */
/*  We use the user's OWN local session banner images, referenced as          */
/*  attachment:// URLs and attached as files alongside each embed. Because    */
/*  they are set via .setImage(), Discord renders them BIG and full-width.    */
/*  No AI-generated graphics are used.                                        */
/*                                                                            */
/*  TOP_BANNER_*  -> Wide main header banner for each session type.           */
/*  BOTTOM_UNDERBANNER -> Thin wide "LOS ANGELES ROLEPLAY" underbanner bar    */
/*                   (own separate embed, .setImage()).                       */
/* -------------------------------------------------------------------------- */

const SESSION_BANNER_NAME_START = 'session-start-banner.png';
const SESSION_BANNER_NAME_END = 'session-end-banner.png';
const SESSION_BANNER_NAME_VOTE = 'session-vote-banner.png';
const SESSION_BANNER_NAME_BOOST = 'session-boost-banner.png';
const SESSION_BANNER_NAME_FULL = 'session-full-banner.png';
const SESSION_UNDERBANNER_NAME = 'underbanner.webp';

export const TOP_BANNER_START = `attachment://${SESSION_BANNER_NAME_START}`;
export const TOP_BANNER_END = `attachment://${SESSION_BANNER_NAME_END}`;
export const TOP_BANNER_VOTE = `attachment://${SESSION_BANNER_NAME_VOTE}`;
export const TOP_BANNER_BOOST = `attachment://${SESSION_BANNER_NAME_BOOST}`;
export const TOP_BANNER_FULL = `attachment://${SESSION_BANNER_NAME_FULL}`;
export const BOTTOM_UNDERBANNER = `attachment://${SESSION_UNDERBANNER_NAME}`;

export const SESSION_BACKGROUND_NAME = 'los_angeles_roleplay_4.webp';
export const SESSION_BACKGROUND_PATH = path.resolve(process.cwd(), 'assets', SESSION_BACKGROUND_NAME);
export const SESSION_BACKGROUND_URL = `attachment://${SESSION_BACKGROUND_NAME}`;
export const SESSION_UNDERBANNER_PATH = path.resolve(process.cwd(), 'assets', SESSION_UNDERBANNER_NAME);

/**
 * Map a session type to its TOP banner image filename.
 */
export function resolveTopBannerName(emblemType: SessionEmblemType): string {
    switch (emblemType) {
        case 'start': return SESSION_BANNER_NAME_START;
        case 'end': return SESSION_BANNER_NAME_END;
        case 'vote': return SESSION_BANNER_NAME_VOTE;
        case 'boost': return SESSION_BANNER_NAME_BOOST;
        case 'full': return SESSION_BANNER_NAME_FULL;
        default: return SESSION_BANNER_NAME_START;
    }
}

/**
 * Map a session type to its TOP image URL constant (attachment://).
 */
export function resolveTopBannerUrl(emblemType: SessionEmblemType): string {
    return `attachment://${resolveTopBannerName(emblemType)}`;
}

export type SessionEmblemType = 'start' | 'end' | 'full' | 'boost' | 'vote';

function assetExists(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

/**
 * Resolve the local banner file for a session type.
 * Falls back to the generic background only if the exact banner is missing.
 */
function resolveSessionBanner(emblemType: SessionEmblemType): { path: string; name: string } {
    const name = resolveTopBannerName(emblemType);
    const resolvedPath = path.resolve(process.cwd(), 'assets', name);
    if (assetExists(resolvedPath)) {
        return { path: resolvedPath, name };
    }
    if (assetExists(SESSION_BACKGROUND_PATH)) {
        return { path: SESSION_BACKGROUND_PATH, name: SESSION_BACKGROUND_NAME };
    }
    return { path: resolvedPath, name };
}

export const SESSION_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
export const SESSION_ACCENT_COLOR = 0xff7a00; // Los Angeles Roleplay Orange (#FF7A00)

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();
};

/**
 * Main session embed. The top banner is rendered INSIDE the embed via
 * .setImage() (already referenced by the attachment:// URL), so it displays
 * big and full-width across the top of the embed. The thin underbanner is
 * placed in a SEPARATE embed directly below (see createUnderbannerEmbed()).
 */
export const createSessionEmbed = (
    title: string,
    description: string,
    color: ColorResolvable = SESSION_ACCENT_COLOR,
    emblemType: SessionEmblemType = 'start',
) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setImage(resolveTopBannerUrl(emblemType))
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();
};

/**
 * Bottom embed (underbanner). A bare image-only embed that sits strictly at
 * the very bottom of the message (after the main text embed).
 */
export const createUnderbannerEmbed = (color: ColorResolvable = SESSION_ACCENT_COLOR) => {
    return new EmbedBuilder()
        .setColor(color)
        .setImage(BOTTOM_UNDERBANNER);
};

/**
 * Attachments for a session announcement.
 *
 * The TOP banner is bound INSIDE the main embed via .setImage() (see
 * createSessionEmbed), so it is NOT attached here as a standalone file —
 * otherwise Discord would drop it as a separate chat image outside the embed.
 *
 * Only the BOTTOM UNDERBANNER is attached here, so the underbanner embed
 * (which uses .setImage('attachment://underbanner.webp')) can render it at
 * the very bottom of the message.
 */
export const createSessionAttachments = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder[] => {
    const attachments: AttachmentBuilder[] = [];

    // BOTTOM UNDERBANNER bar (rendered in the last embed via .setImage()).
    if (assetExists(SESSION_UNDERBANNER_PATH)) {
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
    const banner = resolveSessionBanner(emblemType);
    if (assetExists(banner.path)) {
        return new AttachmentBuilder(banner.path, { name: banner.name });
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
