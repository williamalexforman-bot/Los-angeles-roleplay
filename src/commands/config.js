const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const configCommand = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure and post server panels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('panel')
      .setDescription('Post a Components V2 panel in a channel')
      .addStringOption((option) =>
        option
          .setName('panel')
          .setDescription('The panel to post')
          .setRequired(true)
          .addChoices(
            { name: 'Infraction', value: 'infraction' },
            { name: 'Promotion', value: 'promotion' },
            { name: 'Ticket', value: 'ticket' },
          ),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Where the panel should be posted')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  );

module.exports = { configCommand };
