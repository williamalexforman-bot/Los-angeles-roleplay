import {
    ActionRowBuilder,
    ChatInputCommandInteraction,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger';

function partnershipRequestModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('partnership:request-modal')
        .setTitle('Partnership Request')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('server_name')
                    .setLabel('Server name')
                    .setPlaceholder('Los Angeles Roleplay')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('representative')
                    .setLabel('Server representative')
                    .setPlaceholder('Your Discord username')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('invite_link')
                    .setLabel('Permanent invite link')
                    .setPlaceholder('https://discord.gg/example')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(500)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('server_ad')
                    .setLabel('Server advertisement')
                    .setPlaceholder('Paste or write your full server advertisement here.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setRequired(true),
            ),
        );
}

export const partnershipV2Command = {
    data: new SlashCommandBuilder()
        .setName('partnership')
        .setDescription('Manage Los Angeles Roleplay partnerships')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('request')
                .setDescription('Open the partnership request form'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        interaction.options.getSubcommand(true);

        try {
            await interaction.showModal(partnershipRequestModal());
            logger.info(`[PartnershipV2] Partnership request form opened for ${interaction.user.id} in ${interaction.channelId}.`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.error(`[PartnershipV2] Could not open partnership request form: ${reason}`);
            throw error;
        }
    },
};
