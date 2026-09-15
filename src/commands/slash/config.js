const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { setSetting, getSetting } = require('../../utils/database');
const { ownerId } = require('../../utils/security');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure bot settings (Owner only)')
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set a configuration value')
            .addStringOption(opt => opt.setName('key').setDescription('The setting key').setRequired(true))
            .addStringOption(opt => opt.setName('value').setDescription('The setting value').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View a configuration value')
            .addStringOption(opt => opt.setName('key').setDescription('The setting key').setRequired(true))
        ),

    async execute(interaction) {
        const configuredOwnerId = ownerId();
        if (!configuredOwnerId || interaction.user.id !== configuredOwnerId) {
            return interaction.reply({ content: 'Only the configured server owner can use this command.', flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        const key = interaction.options.getString('key').toUpperCase();

        if (sub === 'set') {
            const value = interaction.options.getString('value');
            setSetting(key, value);
            return interaction.reply({ content: `Successfully set **${key}** to \`${value}\``, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'view') {
            const value = getSetting(key, 'Not set');
            return interaction.reply({ content: `**${key}**: \`${value}\``, flags: MessageFlags.Ephemeral });
        }
    }
};
