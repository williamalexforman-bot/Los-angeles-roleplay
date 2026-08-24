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
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type MessageMentionOptions,
} from 'discord.js';
import { BRAND } from '../config/constants';

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

export const createUnderbannerAttachment = () =>
    new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: SESSION_UNDERBANNER_NAME });

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

function resolveSessionBanner(emblemType: SessionEmblemType): { path: string; name: string } {
    const name = resolveTopBannerName(emblemType);
    const resolvedPath = path.resolve(process.cwd(), 'assets', name);
    if (assetExists(resolvedPath)) return { path: resolvedPath, name };
    if (assetExists(SESSION_BACKGROUND_PATH)) return { path: SESSION_BACKGROUND_PATH, name: SESSION_BACKGROUND_NAME };
    return { path: resolvedPath, name };
}

export const SESSION_FOOTER = 'Los Angeles Roleplay | Realism at its Finest';
export const SESSION_ACCENT_COLOR = 0x3b82f6;

export interface LegacyEmbedV2Options {
    content?: string;
    actionRows?: readonly ActionRowBuilder<ButtonBuilder>[];
    files?: readonly AttachmentBuilder[];
    allowedMentions?: MessageMentionOptions;
    topBannerName?: string;
    topBannerPath?: string;
}

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: SESSION_FOOTER })
        .setTimestamp();
};

function panelSeparator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function textChunks(value: string, maxLength = 3_900): string[] {
    const clean = value.trim();
    if (!clean) return [];
    const chunks: string[] = [];
    let remaining = clean;
    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function addV2Text(panel: ContainerBuilder, value: string): void {
    for (const chunk of textChunks(value)) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
}

function sessionBanner(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}

function inferredFeatureBanner(embed: EmbedBuilder): { name: string; path: string } | null {
    const title = (embed.toJSON().title || '').toLowerCase();
    const filename = title.includes('training result')
        ? 'training-results-banner.webp'
        : title.includes('staff feedback')
            ? 'staff-feedback-banner.webp'
            : null;
    if (!filename) return null;
    const resolvedPath = path.resolve(process.cwd(), 'assets', filename);
    return assetExists(resolvedPath) ? { name: filename, path: resolvedPath } : null;
}

function resolvedLegacyBanner(embed: EmbedBuilder, options: LegacyEmbedV2Options): { name?: string; path?: string } {
    // Never place an attachment:// reference in a Components V2 panel unless
    // the matching file really exists. Previously a missing upper banner could
    // make an otherwise healthy command fail at Discord's message validation.
    if (options.topBannerName && options.topBannerPath && assetExists(options.topBannerPath)) {
        return { name: options.topBannerName, path: options.topBannerPath };
    }
    const inferred = inferredFeatureBanner(embed);
    return inferred ? inferred : {};
}

export function legacyEmbedToV2Panel(embed: EmbedBuilder, options: LegacyEmbedV2Options = {}): ContainerBuilder {
    const data = embed.toJSON();
    const panel = new ContainerBuilder().setAccentColor(data.color ?? SESSION_ACCENT_COLOR);
    const banner = resolvedLegacyBanner(embed, options);

    if (banner.name) {
        panel.addMediaGalleryComponents(sessionBanner(banner.name));
        panel.addSeparatorComponents(panelSeparator());
    }

    if (options.content) addV2Text(panel, options.content);

    const heading = [
        data.author?.name ? `**${data.author.name}**` : '',
        data.title ? `## ${data.title}` : '',
        data.description || '',
    ].filter(Boolean).join('\n');
    if (heading) addV2Text(panel, heading);

    if (data.fields?.length) {
        panel.addSeparatorComponents(panelSeparator());
        for (const field of data.fields) addV2Text(panel, `**${field.name}**\n${field.value}`);
    }

    if (data.image?.url) {
        panel.addSeparatorComponents(panelSeparator());
        panel.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(data.image.url)));
    }

    const footerParts: string[] = [];
    if (data.footer?.text) footerParts.push(data.footer.text);
    if (data.timestamp) {
        const timestamp = Date.parse(data.timestamp);
        if (Number.isFinite(timestamp)) footerParts.push(`<t:${Math.floor(timestamp / 1_000)}:F>`);
    }
    if (footerParts.length) addV2Text(panel, `-# ${footerParts.join(' • ')}`);

    for (const row of options.actionRows || []) panel.addActionRowComponents(row);

    if (assetExists(SESSION_UNDERBANNER_PATH)) {
        panel.addSeparatorComponents(panelSeparator()).addMediaGalleryComponents(sessionBanner(SESSION_UNDERBANNER_NAME));
    }
    return panel;
}

export function legacyEmbedToV2Message(embed: EmbedBuilder, options: LegacyEmbedV2Options = {}) {
    const files = [...(options.files || [])];
    const banner = resolvedLegacyBanner(embed, options);
    if (banner.name && banner.path) {
        files.push(new AttachmentBuilder(banner.path, { name: banner.name }));
    }
    if (assetExists(SESSION_UNDERBANNER_PATH)) files.push(createUnderbannerAttachment());
    return {
        components: [legacyEmbedToV2Panel(embed, options)],
        files,
        flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,
        allowedMentions: options.allowedMentions || { parse: [] as [] },
    };
}

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
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))
                .setButtonAccessory(displayBadge),
        );

    for (const row of actionRows) panel.addActionRowComponents(row);
    if (assetExists(SESSION_UNDERBANNER_PATH)) {
        panel.addSeparatorComponents(panelSeparator()).addMediaGalleryComponents(sessionBanner(SESSION_UNDERBANNER_NAME));
    }
    return panel;
}

export const createSessionAttachments = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder[] => {
    const attachments: AttachmentBuilder[] = [];
    const banner = resolveSessionBanner(emblemType);
    if (assetExists(banner.path)) attachments.push(new AttachmentBuilder(banner.path, { name: banner.name }));
    if (assetExists(SESSION_UNDERBANNER_PATH)) attachments.push(new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: SESSION_UNDERBANNER_NAME }));
    return attachments;
};

export const createBrandedEmbed = (title?: string, description?: string, color = BRAND.color) => {
    const embed = new EmbedBuilder().setColor(color).setFooter({ text: BRAND.footer }).setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    return embed;
};

export const createLogoAttachment = () => new AttachmentBuilder(BRAND.logoPath, { name: BRAND.logoName });

export const createSessionAttachment = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder | undefined => {
    const banner = resolveSessionBanner(emblemType);
    if (assetExists(banner.path)) return new AttachmentBuilder(banner.path, { name: banner.name });
    return undefined;
};

export const createErrorEmbed = (errorMessage: string) => createEmbed('Error', errorMessage);
export const createSuccessEmbed = (successMessage: string) => createEmbed('Success', successMessage);
export const createInfoEmbed = (infoMessage: string) => createEmbed('Information', infoMessage);

export const sendEmbed = async (interaction: ChatInputCommandInteraction, message: string) => {
    const embed = createEmbed('Bot Update', message);
    const payload = legacyEmbedToV2Message(embed);
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
};
