import fs from 'node:fs';
import path from 'node:path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ColorResolvable,
    ContainerBuilder,
    EmbedBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';

/* -------------------------------------------------------------------------- */
/*  Image URL constants.                                                      */
/*                                                                            */
/*  We use the user's OWN local session banner images, referenced as          */
/*  attachment:// URLs and attached as files alongside each Components V2     */
/*  panel. Discord renders each media gallery big and full-width.             */
/*  No AI-generated graphics are used.                                        */
/*                                                                            */
/*  TOP_BANNER_*  -> Wide main header banner for each session type.           */
/*  BOTTOM_UNDERBANNER -> Thin wide "LOS ANGELES ROLEPLAY" underbanner bar    */
/*                   (the final media component in the panel).                */
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
// Matches the blue Components V2 side rail used by the infraction panels.
export const SESSION_ACCENT_COLOR = 0x3b82f6;

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();
};

/**
 * A small separator used around the session copy, matching the visual rhythm
 * of the infraction panels.
 */
function panelSeparator(): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

/**
 * A media gallery wrapper for either supplied session banner. Keeping both
 * media components in one V2 container guarantees the visual order is:
 * top banner, session text/buttons, then underbanner.
 */
function sessionBanner(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

/**
 * Builds a session announcement in the same Components V2 treatment as an
 * infraction case. The supplied top banner is first and the underbanner is
 * always the final component, including when the announcement has buttons.
 */
export function createSessionPanel(
    title: string,
    description: string,
    emblemType: SessionEmblemType,
    actionRows: readonly ActionRowBuilder<ButtonBuilder>[] = [],
    color = SESSION_ACCENT_COLOR,
): ContainerBuilder {
    const displayBadge = new ButtonBuilder()
        .setCustomId(`session:display:${emblemType}`)
        .setLabel(title.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    const panel = new ContainerBuilder()
        .setAccentColor(color)
        .addMediaGalleryComponents(sessionBanner(resolveSessionBanner(emblemType).name))
        .addSeparatorComponents(panelSeparator())
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${title}\n${description}`),
                )
                .setButtonAccessory(displayBadge),
        );

    for (const row of actionRows) panel.addActionRowComponents(row);

    return panel
        .addSeparatorComponents(panelSeparator())
        .addMediaGalleryComponents(sessionBanner(SESSION_UNDERBANNER_NAME));
}

/**
 * Attachments for a session announcement.
 *
 * Attaches the original top banner and bottom underbanner separately. They are
 * used by createSessionPanel() in that exact order.
 */
export const createSessionAttachments = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder[] => {
    const attachments: AttachmentBuilder[] = [];

    // Attach the type-specific top banner used by the first media gallery.
    const banner = resolveSessionBanner(emblemType);
    if (assetExists(banner.path)) {
        attachments.push(new AttachmentBuilder(banner.path, { name: banner.name }));
    }

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
