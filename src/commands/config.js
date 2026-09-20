const D = require('discord.js');
const { CHANNELS, TYPES, TICKETS } = require('../settings');
const roleGated = cmd => cmd.setDefaultMemberPermissions(null).setDMPermission(false);
const admin = cmd => cmd.setDefaultMemberPermissions(D.PermissionFlagsBits.Administrator).setDMPermission(false);
const configCommand = admin(new D.SlashCommandBuilder().setName('config').setDescription('Set channels, ticket access and post panels'))
.addSubcommand(s => s.setName('view').setDescription('View configured destinations'))
.addSubcommand(s => s.setName('channel').setDescription('Change a destination')
  .addStringOption(o => o.setName('destination').setDescription('Destination').setRequired(true).addChoices(...Object.keys(CHANNELS).slice(0,25).map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Channel or ticket category').setRequired(true).addChannelTypes(D.ChannelType.GuildCategory, D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('panel').setDescription('Post a V2 panel')
  .addStringOption(o => o.setName('panel').setDescription('Panel').setRequired(true).addChoices(...['ticket','shift','information','employee','cadet','oia'].map(value => ({ name: value, value }))))
  .addChannelOption(o => o.setName('channel').setDescription('Optional panel channel override').addChannelTypes(D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement)))
.addSubcommand(s => s.setName('ticket-access').setDescription('Set the support role for one department')
  .addStringOption(o => o.setName('department').setDescription('Department').setRequired(true).addChoices(...Object.entries(TICKETS).map(([value,name]) => ({name,value}))))
  .addRoleOption(o => o.setName('role').setDescription('Role allowed to read this department’s tickets').setRequired(true)));
configCommand.addSubcommand(s=>s.setName('staff-role').setDescription('Configure staff access or deployment mentions').addStringOption(o=>o.setName('purpose').setDescription('Role purpose').setRequired(true).addChoices(...['management','infraction','promotion','deployment_ping','hr','say'].map(value=>({name:value,value})))).addRoleOption(o=>o.setName('role').setDescription('Server role').setRequired(true)));
const infraction = roleGated(new D.SlashCommandBuilder().setName('infraction').setDescription('Manage staff infraction cases'))
.addSubcommand(s => s.setName('issue').setDescription('Issue a staff infraction')
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addStringOption(o => o.setName('action').setDescription('Infraction action').setRequired(true).addChoices(...TYPES.map(value=>({name:value,value}))))
.addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1024))
.addStringOption(o => o.setName('notes').setDescription('Notes or rule broken').setRequired(true).setMaxLength(800))
.addBooleanOption(o => o.setName('appealable').setDescription('Can this infraction be appealed?').setRequired(true))
.addStringOption(o => o.setName('evidence').setDescription('Evidence link or details').setMaxLength(800))
.addBooleanOption(o => o.setName('notify-member').setDescription('Send a DM (default: yes)'))
.addStringOption(o => o.setName('suspension-end').setDescription('Optional expiry: YYYY-MM-DD HH:mm UTC; omit for indefinite').setMaxLength(16)));
infraction.addSubcommand(s=>s.setName('edit').setDescription('Edit an existing infraction notice')
 .addStringOption(o=>o.setName('case-id').setDescription('Case ID from the infraction, with or without INF-').setRequired(true))
 .addStringOption(o=>o.setName('change-reason').setDescription('Why this record is being edited').setRequired(true).setMaxLength(500))
 .addStringOption(o=>o.setName('reason').setDescription('Replacement infraction reason').setMaxLength(1024))
 .addStringOption(o=>o.setName('notes').setDescription('Replacement notes; enter None to clear the content').setMaxLength(800))
 .addStringOption(o=>o.setName('evidence').setDescription('Replacement evidence; enter None if absent').setMaxLength(800))
 .addBooleanOption(o=>o.setName('appealable').setDescription('Allow or disable appeals')));
infraction.addSubcommand(s=>s.setName('revoke').setDescription('Revoke a case and recalculate active counts and roles')
 .addStringOption(o=>o.setName('case-id').setDescription('Case ID from the infraction, with or without INF-').setRequired(true))
 .addStringOption(o=>o.setName('reason').setDescription('Why this infraction is being revoked').setRequired(true).setMaxLength(500)));
const promotion = roleGated(new D.SlashCommandBuilder().setName('promotion').setDescription('Manage staff promotions'))
.addSubcommand(s => s.setName('issue').setDescription('Issue and publish a staff promotion')
.addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
.addRoleOption(o => o.setName('old-rank').setDescription('Current rank').setRequired(true))
.addRoleOption(o => o.setName('new-role').setDescription('New rank').setRequired(true))
.addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1024))
.addUserOption(o => o.setName('approved-by').setDescription('Who approved this promotion').setRequired(true))
.addStringOption(o => o.setName('effective-date').setDescription('Displayed effective date; roles change when submitted').setRequired(true).setMaxLength(100)));
const suspension = roleGated(new D.SlashCommandBuilder().setName('suspension').setDescription('Manage saved suspensions')).addSubcommand(s=>s.setName('end').setDescription('End a suspension and restore saved roles').addUserOption(o=>o.setName('member').setDescription('Suspended member').setRequired(true)));
const deployment = roleGated(new D.SlashCommandBuilder().setName('deployment').setDescription('Announce an active deployment and ping the deployment role'));
const close = roleGated(new D.SlashCommandBuilder().setName('close').setDescription('Save the transcript and close this ticket'));
const closerequest = roleGated(new D.SlashCommandBuilder().setName('closerequest').setDescription('Ask the ticket opener to close this ticket').addStringOption(o=>o.setName('reason').setDescription('Why should this ticket close?').setRequired(true).setMaxLength(1000)));
const ticketpanel = roleGated(new D.SlashCommandBuilder().setName('ticketpanel').setDescription('Post the ticket panel in the configured channel'));
const requestrole=new D.SlashCommandBuilder().setName('requestrole').setDescription('Ask HR to approve a trainee role').setDMPermission(false).addUserOption(o=>o.setName('trainee').setDescription('Member receiving the role').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Requested role').setRequired(true));
const addEmojis=admin(new D.SlashCommandBuilder().setName('add-emojis').setDescription('Install a batch of transparent CFD panel emojis'));
const say=roleGated(new D.SlashCommandBuilder().setName('say').setDescription('Send a message as the bot').addStringOption(o=>o.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(2000)));
const shift=new D.SlashCommandBuilder().setName('shift').setDescription('Track your shift time').setDMPermission(false);
for(const action of ['start','end','status'])shift.addSubcommand(s=>s.setName(action).setDescription(`${action} your shift`));
const cmds = new D.SlashCommandBuilder().setName('cmds').setDescription('List every command and what it does').setDMPermission(false);
shift.addSubcommand(s=>s.setName('view').setDescription('View a member’s weekly shift time and quota').addUserOption(o=>o.setName('member').setDescription('Member to view')));
const quota=new D.SlashCommandBuilder().setName('quota').setDescription('Weekly quota controls').setDMPermission(false);
for(const action of ['status','enable','disable'])quota.addSubcommand(s=>s.setName(action).setDescription(`${action} weekly quota`));
module.exports = { configCommand, commands: [configCommand, infraction, promotion, suspension, deployment, close, closerequest, ticketpanel, requestrole, addEmojis, say, shift, quota, cmds] };
