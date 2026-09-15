const D = require('discord.js');
const { CHANNELS, TYPES, TICKETS } = require('../settings');
const admin = cmd => cmd.setDefaultMemberPermissions(D.PermissionFlagsBits.Administrator).setDMPermission(false);
const configCommand = admin(new D.SlashCommandBuilder().setName('config').setDescription('Set channels, ticket access and post panels'))
.addSubcommand(s => s.setName('view').setDescription('View configured destinations'))
.addSubcommand(s => s.setName('channel').setDescription('Change a destination')
  .addStringOption(o => o.setName('destination').setDescription('Destination').setRequired(true).addChoices(...Object.keys(CHANNELS).map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Channel or ticket category').setRequired(true).addChannelTypes(D.ChannelType.GuildCategory, D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('panel').setDescription('Post a V2 panel')
  .addStringOption(o => o.setName('panel').setDescription('Panel').setRequired(true).addChoices(...['infraction','promotion','ticket','shift'].map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Optional panel channel override').addChannelTypes(D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('ticket-access').setDescription('Set the support role for one department')
  .addStringOption(o => o.setName('department').setDescription('Department').setRequired(true).addChoices(...Object.entries(TICKETS).map(([value,name]) => ({name,value}))))
  .addRoleOption(o => o.setName('role').setDescription('Role allowed to read this department’s tickets').setRequired(true)));
configCommand.addSubcommand(s => s.setName('shift-role').setDescription('Set the role allowed to start staff shifts').addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)));
const shift = new D.SlashCommandBuilder().setName('shift').setDescription('Manage your staff shift').setDMPermission(false);
for (const name of ['start','end','status']) shift.addSubcommand(s => s.setName(name).setDescription(`${name} your staff shift`));
const infraction = admin(new D.SlashCommandBuilder().setName('infraction').setDescription('Issue a recorded infraction'))
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addStringOption(o => o.setName('type').setDescription('Infraction type').setRequired(true).addChoices(...TYPES.map(value => ({name:value,value}))));
const promotion = admin(new D.SlashCommandBuilder().setName('promotion').setDescription('Record and apply a rank change'))
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addRoleOption(o => o.setName('previous-rank').setDescription('Current rank').setRequired(true))
.addRoleOption(o => o.setName('new-rank').setDescription('New rank').setRequired(true));
module.exports = { configCommand, commands: [configCommand, infraction, promotion, shift] };
