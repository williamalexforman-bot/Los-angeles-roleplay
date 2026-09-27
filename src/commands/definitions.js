const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('View the bot command directory'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('View information about this server'),
  new SlashCommandBuilder().setName('userinfo').setDescription('View information about a member').addUserOption(o => o.setName('member').setDescription('Member to view')),
  new SlashCommandBuilder().setName('botinfo').setDescription('View bot status and version'),
  new SlashCommandBuilder().setName('config').setDescription('Open the private server configuration dashboard'),
  new SlashCommandBuilder().setName('showcase').setDescription('Share and manage designs')
    .addSubcommand(s => s.setName('submit').setDescription('Submit a design').addStringOption(o => o.setName('title').setDescription('Design title').setRequired(true).setMaxLength(100)).addStringOption(o => o.setName('description').setDescription('Describe the design').setRequired(true).setMaxLength(1000)).addStringOption(o => o.setName('category').setDescription('Design category').setRequired(true).addChoices(...['Logo','Server Icon','Advertisement','Social Media','Thumbnail','Clothing','Livery','UI','Poster','Illustration','Other'].map(v => ({ name:v, value:v })))).addAttachmentOption(o => o.setName('image').setDescription('Design image').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View a submission').addStringOption(o => o.setName('id').setDescription('Submission ID').setRequired(true)))
    .addSubcommand(s => s.setName('mine').setDescription('View your submissions'))
    .addSubcommand(s => s.setName('feature').setDescription('Feature a submission').addStringOption(o => o.setName('id').setDescription('Submission ID').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a submission').addStringOption(o => o.setName('id').setDescription('Submission ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Removal reason').setRequired(true)))
    .addSubcommand(s => s.setName('restore').setDescription('Restore a submission').addStringOption(o => o.setName('id').setDescription('Submission ID').setRequired(true))),
  new SlashCommandBuilder().setName('portfolio').setDescription('Create and view designer portfolios')
    .addSubcommand(s => s.setName('create').setDescription('Create or replace your portfolio').addStringOption(o => o.setName('title').setDescription('Portfolio title').setRequired(true).setMaxLength(100)).addStringOption(o => o.setName('bio').setDescription('Short biography').setRequired(true).setMaxLength(1000)).addStringOption(o => o.setName('specialties').setDescription('Design specialties').setRequired(true).setMaxLength(500)).addStringOption(o => o.setName('software').setDescription('Software used').setRequired(true).setMaxLength(500)).addStringOption(o => o.setName('links').setDescription('Portfolio links').setMaxLength(1000)))
    .addSubcommand(s => s.setName('view').setDescription('View a portfolio').addUserOption(o => o.setName('member').setDescription('Portfolio owner')))
    .addSubcommand(s => s.setName('visibility').setDescription('Set portfolio visibility').addBooleanOption(o => o.setName('visible').setDescription('Publicly visible').setRequired(true))),
  new SlashCommandBuilder().setName('request').setDescription('Create and manage design requests')
    .addSubcommand(s => s.setName('create').setDescription('Open the design request form'))
    .addSubcommand(s => s.setName('view').setDescription('View a request').addStringOption(o => o.setName('id').setDescription('Request ID').setRequired(true)))
    .addSubcommand(s => s.setName('mine').setDescription('View your requests'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim a request').addStringOption(o => o.setName('id').setDescription('Request ID').setRequired(true)))
    .addSubcommand(s => s.setName('status').setDescription('Change a request status').addStringOption(o => o.setName('id').setDescription('Request ID').setRequired(true)).addStringOption(o => o.setName('status').setDescription('New status').setRequired(true).addChoices(...['under-review','accepted','declined','in-progress','waiting-for-client','ready-for-review','revision-requested','completed','cancelled','closed'].map(v => ({ name:v.replaceAll('-',' '), value:v })))).addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)))
    .addSubcommand(s => s.setName('close').setDescription('Close a request').addStringOption(o => o.setName('id').setDescription('Request ID').setRequired(true)))
    .addSubcommand(s => s.setName('reopen').setDescription('Reopen a request').addStringOption(o => o.setName('id').setDescription('Request ID').setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket tools')
    .addSubcommand(s => s.setName('panel').setDescription('Post the ticket panel'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket'))
    .addSubcommand(s => s.setName('unclaim').setDescription('Unclaim this ticket'))
    .addSubcommand(s => s.setName('add').setDescription('Add a member').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a member').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand(s => s.setName('rename').setDescription('Rename this ticket').addStringOption(o => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)))
    .addSubcommand(s => s.setName('close').setDescription('Close this ticket').addStringOption(o => o.setName('reason').setDescription('Closure reason').setRequired(true).setMaxLength(500)))
    .addSubcommand(s => s.setName('reopen').setDescription('Reopen a saved ticket').addStringOption(o => o.setName('id').setDescription('Ticket ID').setRequired(true)))
    .addSubcommand(s => s.setName('transcript').setDescription('Save a ticket transcript'))
    .addSubcommand(s => s.setName('note').setDescription('Add a staff note').addStringOption(o => o.setName('note').setDescription('Private staff note').setRequired(true).setMaxLength(1000))),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)).addStringOption(o => o.setName('evidence').setDescription('Evidence link or details').setMaxLength(1000)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Examples: 10m, 2h, 1d').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user').addStringOption(o => o.setName('user-id').setDescription('Discord user ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages').addIntegerOption(o => o.setName('amount').setDescription('Number of messages, 1-100').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode').addIntegerOption(o => o.setName('seconds').setDescription('0 disables slowmode').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('history').setDescription('View moderation history').addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('case').setDescription('Manage moderation cases')
    .addSubcommand(s => s.setName('view').setDescription('View a case').addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit a case reason').addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('New reason').setRequired(true)))
    .addSubcommand(s => s.setName('revoke').setDescription('Revoke a case').addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Revocation reason').setRequired(true)))
];

module.exports = { commands };
