const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Msg, env, tpl, logo } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a DM to a user')
        .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('Message to send').setRequired(true)),

    async execute(interaction) {
        const managementRole = process.env.MANAGEMENT_ROLE_ID;
        if (managementRole && !interaction.member.roles.cache.has(managementRole)) {
            return interaction.reply({ content: env('NO_PERMISSION_MSG', 'You do not have permission to use this command.'), flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('user');
        const msg = interaction.options.getString('message');

        try {
            const payload = v2Msg({
                title: tpl(env('DM_TITLE', 'Message from {server}'), { server: interaction.guild.name }),
                description: msg,
                thumbnail: logo()
            });

            await user.send(payload);
            return interaction.reply({ content: `Message sent to ${user}.`, flags: MessageFlags.Ephemeral });
        } catch (e) {
            return interaction.reply({ content: 'Failed to send DM. The user may have DMs disabled.', flags: MessageFlags.Ephemeral });
        }
    }
};
