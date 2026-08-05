import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants';

export const SESSION_BACKGROUND_NAME = 'los_angeles_roleplay_4.webp';
export const SESSION_BACKGROUND_PATH = path.resolve(process.cwd(), 'assets', SESSION_BACKGROUND_NAME);
export const SESSION_BACKGROUND_URL = `attachment://${SESSION_BACKGROUND_NAME}`;

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
};

export const createSessionEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    const embed = createEmbed(title, description, color);
    if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
        embed.setImage(SESSION_BACKGROUND_URL);
    }
    return embed;
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

export const createSessionAttachment = (): AttachmentBuilder | undefined => {
    if (fs.existsSync(SESSION_BACKGROUND_PATH)) {
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
