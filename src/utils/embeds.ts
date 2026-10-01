import { AttachmentBuilder, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND } from '../config/constants';
import { embedsToV2 } from './componentsV2';

export const createEmbed = (title: string, description: string, color: ColorResolvable = BRAND.color) => {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(BRAND.logoUrl)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
};

export const createBrandedEmbed = (title?: string, description?: string, color = BRAND.color) => {
    const embed = new EmbedBuilder()
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    return embed;
};

export const createLogoAttachment = () => new AttachmentBuilder(BRAND.logoPath, { name: BRAND.logoName });

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
        return interaction.followUp({ components: embedsToV2([embed]), files: [createLogoAttachment()], flags: MessageFlags.IsComponentsV2 });
    }

    return interaction.reply({ components: embedsToV2([embed]), files: [createLogoAttachment()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
};
