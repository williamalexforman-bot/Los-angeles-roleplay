import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants';

export const SESSION_BACKGROUND_NAME = 'los_angeles_roleplay_4.webp';
export const SESSION_BACKGROUND_PATH = path.resolve(process.cwd(), 'assets', SESSION_BACKGROUND_NAME);
export const SESSION_BACKGROUND_URL = `attachment://${SESSION_BACKGROUND_NAME}`;
export const SESSION_UNDERBANNER_NAME = 'underbanner.webp';
export const SESSION_UNDERBANNER_PATH = path.resolve(process.cwd(), 'assets', SESSION_UNDERBANNER_NAME);
export const SESSION_UNDERBANNER_URL = `attachment://${SESSION_UNDERBANNER_NAME}`;

export type SessionEmblemType = 'start' | 'end' | 'full' | 'boost' | 'vote';

const SESSION_EMBLEM_CANDIDATES: Record<SessionEmblemType, string[]> = {
    start: ['session-start.png', 'session start'],
    end: ['session-end.png', 'session end'],
    full: ['session-full.png', 'session full'],
    boost: ['session-boost.png', 'session boost'],
    vote: ['session-vote.png', 'Session vote', 'Copy of Dashboard (9).png'],
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

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
};

export const createSessionEmbed = (
    title: string,
    description: string,
    color: ColorResolvable = BRAND.color,
    emblemType: SessionEmblemType = 'start',
) => {
    const embed = createEmbed(title, description, color);
    const emblem = resolveSessionEmblem(emblemType);
    if (emblem) {
        embed.setImage(`attachment://${emblem.name}`);
    } else if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
        embed.setImage(SESSION_BACKGROUND_URL);
    }
    return embed;
};

export const createSessionAttachments = (emblemType: SessionEmblemType = 'start'): AttachmentBuilder[] => {
    const attachments: AttachmentBuilder[] = [];
    const emblem = resolveSessionEmblem(emblemType);

    if (emblem) {
        attachments.push(new AttachmentBuilder(emblem.path, { name: emblem.name }));
    } else if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
        attachments.push(new AttachmentBuilder(SESSION_BACKGROUND_PATH, { name: SESSION_BACKGROUND_NAME }));
    }

    if (fs.existsSync(SESSION_UNDERBANNER_PATH)) {
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
