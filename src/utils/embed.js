const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Create a custom embed'),

    async execute(interaction) {
        const staffRole = process.env.STAFF_ROLE_ID;
        if (staffRole && !interaction.member.roles.cache.has(staffRole)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('embed_modal')
            .setTitle('Custom Embed Builder');

        const titleInput = new TextInputBuilder().setCustomId('embed_title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('embed_description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true);
        const colorInput = new TextInputBuilder().setCustomId('embed_color').setLabel('Color (hex, e.g. FF0000)').setStyle(TextInputStyle.Short).setRequired(false);
        const footerInput = new TextInputBuilder().setCustomId('embed_footer').setLabel('Footer').setStyle(TextInputStyle.Short).setRequired(false);
        const thumbInput = new TextInputBuilder().setCustomId('embed_thumbnail').setLabel('Thumbnail URL').setStyle(TextInputStyle.Short).setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(thumbInput)
        );

        await interaction.showModal(modal);
    }
};
