const D = require('discord.js');
const { CHANNELS, TYPES, TICKETS } = require('../settings');
const admin = cmd => cmd.setDefaultMemberPermissions(D.PermissionFlagsBits.Administrator).setDMPermission(false);
const configCommand = admin(new D.SlashCommandBuilder().setName('config').setDescription('Set channels, ticket access and post panels'))
.addSubcommand(s => s.setName('view').setDescription('View configured destinations'))
.addSubcommand(s => s.setName('channel').setDescription('Change a destination')
  .addStringOption(o => o.setName('destination').setDescription('Destination').setRequired(true).addChoices(...Object.keys(CHANNELS).map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Channel or ticket category').setRequired(true).addChannelTypes(D.ChannelType.GuildCategory, D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('panel').setDescription('Post a V2 panel')
  .addStringOption(o => o.setName('panel').setDescription('Panel').setRequired(true).addChoices(...['ticket','shift'].map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Optional panel channel override').addChannelTypes(D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('ticket-access').setDescription('Set the support role for one department')
  .addStringOption(o => o.setName('department').setDescription('Department').setRequired(true).addChoices(...Object.entries(TICKETS).map(([value,name]) => ({name,value}))))
  .addRoleOption(o => o.setName('role').setDescription('Role allowed to read this department’s tickets').setRequired(true)));
configCommand.addSubcommand(s => s.setName('shift-role').setDescription('Set the role allowed to start staff shifts').addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)));
const shift = new D.SlashCommandBuilder().setName('shift').setDescription('Manage your staff shift').setDMPermission(false);
for (const name of ['start','end','status']) shift.addSubcommand(s => s.setName(name).setDescription(`${name} your staff shift`));
const infraction = admin(new D.SlashCommandBuilder().setName('infraction').setDescription('Manage staff infraction cases'))
.addSubcommand(s => s.setName('issue').setDescription('Issue a staff infraction')
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addStringOption(o => o.setName('action').setDescription('Infraction action').setRequired(true).addChoices(...TYPES.map(value=>({name:value,value}))))
.addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1024))
.addStringOption(o => o.setName('notes').setDescription('Notes or rule broken').setRequired(true).setMaxLength(800))
.addBooleanOption(o => o.setName('appealable').setDescription('Can this infraction be appealed?').setRequired(true))
.addStringOption(o => o.setName('evidence').setDescription('Evidence link or details').setMaxLength(800))
.addBooleanOption(o => o.setName('notify-member').setDescription('Send a DM (default: yes)'))
.addStringOption(o => o.setName('suspension-end').setDescription('Optional expiry: YYYY-MM-DD HH:mm UTC; omit for indefinite').setMaxLength(16)));
const promotion = admin(new D.SlashCommandBuilder().setName('promotion').setDescription('Manage staff promotions'))
.addSubcommand(s => s.setName('issue').setDescription('Issue and publish a staff promotion')
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addRoleOption(o => o.setName('old-rank').setDescription('Current rank').setRequired(true))
.addRoleOption(o => o.setName('new-role').setDescription('New rank').setRequired(true))
.addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1024))
.addUserOption(o => o.setName('approved-by').setDescription('Who approved this promotion').setRequired(true))
.addStringOption(o => o.setName('effective-date').setDescription('Displayed effective date; roles change when submitted').setRequired(true).setMaxLength(100)));
const suspension = admin(new D.SlashCommandBuilder().setName('suspension').setDescription('Manage saved suspensions')).addSubcommand(s=>s.setName('end').setDescription('End a suspension and restore saved roles').addUserOption(o=>o.setName('member').setDescription('Suspended member').setRequired(true)));
module.exports = { configCommand, commands: [configCommand, infraction, promotion, shift, suspension] };
