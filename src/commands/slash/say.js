const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/security');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Make the bot say something.')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('What the bot should say')
                .setRequired(true)
        )
        .setDMPermission(false),

    async execute(interaction) {
        if (!hasPermission(interaction.member, 'SAY_ROLE_ID')) {
            return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
        }

        const text = interaction.options.getString('text');
        
        try {
            await interaction.channel.send(`${text}\n\n-# Sent by ${interaction.user}`);
            await interaction.reply({ content: 'Message sent!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            await interaction.reply({ content: 'Failed to send message.', flags: MessageFlags.Ephemeral });
        }
    }
};
