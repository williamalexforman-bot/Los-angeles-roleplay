const D = require('discord.js');
const { CHANNELS, TYPES, TICKETS } = require('../settings');
const roleGated = cmd => cmd.setDefaultMemberPermissions(null).setDMPermission(false);
const admin = cmd => cmd.setDefaultMemberPermissions(D.PermissionFlagsBits.Administrator).setDMPermission(false);
const configCommand = roleGated(new D.SlashCommandBuilder().setName('config').setDescription('Open the private interactive bot configuration dashboard'));
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
const lock = roleGated(new D.SlashCommandBuilder().setName('lock').setDescription('Prevent members from speaking in this channel'));
const unlock = roleGated(new D.SlashCommandBuilder().setName('unlock').setDescription('Restore this channel’s permissions from before it was locked'));
const removefrom = roleGated(new D.SlashCommandBuilder().setName('removefrom').setDescription('Remove a member from the current ticket').addUserOption(o=>o.setName('user').setDescription('Member to remove from this ticket').setRequired(true)));
const requestrole=new D.SlashCommandBuilder().setName('requestrole').setDescription('Ask HR to approve a trainee role').setDMPermission(false).addUserOption(o=>o.setName('trainee').setDescription('Member receiving the role').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Requested role').setRequired(true));
const addEmojis=admin(new D.SlashCommandBuilder().setName('add-emojis').setDescription('Install a batch of transparent CFD panel emojis'));
const say=roleGated(new D.SlashCommandBuilder().setName('say').setDescription('Send a message as the bot').addStringOption(o=>o.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(2000)));
const dm=new D.SlashCommandBuilder().setName('dm').setDescription('Owner: send one user a direct message').setDMPermission(false)
 .addUserOption(o=>o.setName('user').setDescription('User to message').setRequired(true))
 .addStringOption(o=>o.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(2000));
const role=new D.SlashCommandBuilder().setName('role').setDescription('Owner: add or remove a manageable role').setDMPermission(false);
for(const action of ['add','remove'])role.addSubcommand(s=>s.setName(action).setDescription(`${action} a role from a server member`).addUserOption(o=>o.setName('user').setDescription('Server member').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role to change').setRequired(true)));
const shift=new D.SlashCommandBuilder().setName('shift').setDescription('Open your private shift controls').setDMPermission(false);
const cmds = new D.SlashCommandBuilder().setName('cmds').setDescription('List every command and what it does').setDMPermission(false);
const fastpass=roleGated(new D.SlashCommandBuilder().setName('fastpass').setDescription('Send a Fast Pass request form in this ticket'));
const activityCheck=roleGated(new D.SlashCommandBuilder().setName('activity-check').setDescription('Start an activity check in announcements'));
const application=new D.SlashCommandBuilder().setName('application').setDescription('Open the Clearwater Fire & Rescue application').setDMPermission(false);
const quota=new D.SlashCommandBuilder().setName('quota').setDescription('Weekly quota controls').setDMPermission(false);
for(const action of ['status','enable','disable'])quota.addSubcommand(s=>s.setName(action).setDescription(`${action} weekly quota`));
module.exports = { configCommand, commands: [configCommand, infraction, promotion, suspension, deployment, close, closerequest, ticketpanel, lock, unlock, removefrom, requestrole, addEmojis, say, dm, role, shift, quota, cmds, fastpass, activityCheck, application] };
