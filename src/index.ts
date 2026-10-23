// @ts-nocheck
import 'dotenv/config';
import { createServer } from 'node:http';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, ContainerBuilder,
  EmbedBuilder, Events, GatewayIntentBits, MessageFlags, ModalBuilder, REST, Routes,
  SlashCommandBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
  MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '1516451513680003303';
const PREFIX = process.env.PREFIX || '-';
const BLOXLINK_API_KEY = process.env.BLOXLINK_API_KEY;
const ERLC_API_KEY = process.env.ERLC_API || process.env.ERLC_SERVER_KEY;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1546571043160989897';
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1546571044620476550';
const CITIZEN_ROLE_ID = process.env.CITIZEN_ROLE_ID || '1546570995698110545';
const VERIFY_LOG_CHANNEL_ID = process.env.VERIFICATION_LOG_CHANNEL_ID || '1546571436775309492';
const VERIFY_BANNER = 'https://cdn.phototourl.com/member/2026-10-23-7df6376d-8d65-4981-93f6-17436d3189ca.png';

const CFG = {
  name: 'California State Roleplay',
  short: 'CaliRP',
  channels: {
    ticketPanel: '1546571353459794000', ticketLogs: '1546571291589607617',
    welcome: '1546571410070306928', sessions: '1546571384451366982',
    infractions: '1546571428663664810', promotions: '1546571427170353262',
    applicationPanel: '1546571350804660331', applicationResults: '1546571405230080131',
    giveaways: '1555574069359939624', erlcJoinLeave: '1546571444769656853',
    boost: '1546571364109123709', modLogs: '1546571436775309492',
  },
  categories: {
    general: '1555574910188003478', highRank: '1555574996561301514',
    applications: '1555575058238275725',
  },
  roles: {
    support: '1546571011040870492', highRankSupport: '1553895839498502144',
    staff: '1546570963490177136', sessionPing: '1546571056611856504',
  },
};

if (!TOKEN || !CLIENT_ID) throw new Error('Set BOT_TOKEN (or DISCORD_TOKEN) and CLIENT_ID (or DISCORD_CLIENT_ID) in Render Environment.');

// Render Web Services expect an HTTP listener; this lightweight endpoint keeps the service healthy.
const port = Number(process.env.PORT || 10000);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('California State Roleplay bot is running.');
}).listen(port, '0.0.0.0', () => console.log(`Health endpoint listening on port ${port}`));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent],
});
const rest = new REST({ version: '10' }).setToken(TOKEN);
const activeTickets = new Map<string, { opener: string; claimedBy?: string; type: string }>();
const giveawayEntrants = new Map<string, Set<string>>();
const giveawayMessages = new Map<string, any>();
const ticketBlocked = new Set<string>();
const botBlocked = new Set<string>();
const liveryWhitelist = new Set<string>();
const commsWhitelist = new Set<string>();
const groupRequests: string[] = [];
let applicationsEnabled = true;
let commsMessage = 'Please keep all communications professional and follow server regulations.';
let sessionVoteThreshold = 10;
let sessionVotes = new Set<string>();

const say = new SlashCommandBuilder().setName('say').setDescription('Send a message as the bot.')
  .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(2000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
const relink = new SlashCommandBuilder().setName('relink').setDescription('Instructions to link or change your Roblox account with Bloxlink.');
const verifyPanel = new SlashCommandBuilder().setName('verification-panel').setDescription('Post the Roblox verification panel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const getinfo = new SlashCommandBuilder().setName('getinfo').setDescription('Look up a Discord member’s linked Roblox account.')
  .addUserOption(o => o.setName('user').setDescription('Member to look up').setRequired(false));
const rid = new SlashCommandBuilder().setName('rid').setDescription('Look up a Roblox username or user ID.')
  .addStringOption(o => o.setName('username').setDescription('Roblox username or numeric ID').setRequired(true));
const erlc = new SlashCommandBuilder().setName('erlc').setDescription('ER:LC private server tools.')
  .addSubcommand(s => s.setName('info').setDescription('Show server information.'))
  .addSubcommand(s => s.setName('players').setDescription('List players in the ER:LC server.'))
  .addSubcommand(s => s.setName('command').setDescription('Run an allowlisted in-game command.')
    .addStringOption(o => o.setName('command').setDescription('Command, e.g. :h Session starting').setRequired(true).setMaxLength(300)))
  .addSubcommand(s => s.setName('run').setDescription('Run an allowlisted in-game command.')
    .addStringOption(o => o.setName('command').setDescription('Command, e.g. :h Session starting').setRequired(true).setMaxLength(300)));
const ticketPanel = new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the CSRP support ticket panel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const ticketClose = new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current ticket.')
  .addStringOption(o => o.setName('reason').setDescription('Closing reason').setRequired(false).setMaxLength(300));
const ticketAdd = new SlashCommandBuilder().setName('ticket-add').setDescription('Add a member to this ticket.')
  .addUserOption(o => o.setName('user').setDescription('Member to add').setRequired(true));
const infraction = new SlashCommandBuilder().setName('infraction').setDescription('Issue a staff infraction.')
  .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(o => o.setName('type').setDescription('Infraction type').setRequired(true)
    .addChoices({name:'Warning',value:'Warning'},{name:'Strike',value:'Strike'},{name:'Suspension',value:'Suspension'},{name:'Demotion',value:'Demotion'},{name:'Termination',value:'Termination'},{name:'Under Investigation',value:'Under Investigation'},{name:'Note',value:'Note'}))
  .addStringOption(o => o.setName('reason').setDescription('Reason and rule broken').setRequired(true).setMaxLength(1000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
const promotion = new SlashCommandBuilder().setName('promotion').setDescription('Log a staff promotion.')
  .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(o => o.setName('rank').setDescription('New rank').setRequired(true).setMaxLength(100))
  .addStringOption(o => o.setName('reason').setDescription('Reason for promotion').setRequired(true).setMaxLength(1000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
const sessionStart = new SlashCommandBuilder().setName('session-start').setDescription('Announce a roleplay session.')
  .addStringOption(o => o.setName('host').setDescription('Session host').setRequired(false).setMaxLength(100))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const sessionEnd = new SlashCommandBuilder().setName('session-end').setDescription('Announce that the session has ended.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const appPanel = new SlashCommandBuilder().setName('application-panel').setDescription('Post staff/media application buttons.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const giveawayStart = new SlashCommandBuilder().setName('giveaway-start').setDescription('Start a simple giveaway.')
  .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true).setMaxLength(200))
  .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(10080))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const help = new SlashCommandBuilder().setName('help').setDescription('Show bot commands.');
const ping = new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.');


const ticketGroup = new SlashCommandBuilder().setName('ticket').setDescription('Ticket management.')
  .addSubcommand(s=>s.setName('add').setDescription('Add a user to this ticket.').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s=>s.setName('remove').setDescription('Remove a user from this ticket.').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s=>s.setName('claim').setDescription('Claim this ticket.'))
  .addSubcommand(s=>s.setName('unclaim').setDescription('Unclaim this ticket.'))
  .addSubcommand(s=>s.setName('close').setDescription('Close this ticket.'))
  .addSubcommand(s=>s.setName('close-request').setDescription('Ask the opener to confirm closing.'));
const sessionGroup = new SlashCommandBuilder().setName('session').setDescription('Session announcements.')
  .addSubcommand(s=>s.setName('vote').setDescription('Start a session vote.').addIntegerOption(o=>o.setName('votes').setDescription('Votes required').setRequired(true).setMinValue(1).setMaxValue(100)))
  .addSubcommand(s=>s.setName('startup').setDescription('Announce session startup.'))
  .addSubcommand(s=>s.setName('shutdown').setDescription('Announce session shutdown.'))
  .addSubcommand(s=>s.setName('low').setDescription('Announce low player count.'))
  .addSubcommand(s=>s.setName('full').setDescription('Announce server full.'));
const commsGroup = new SlashCommandBuilder().setName('comms').setDescription('Comms checker settings.')
  .addSubcommand(s=>s.setName('whitelist').setDescription('Whitelist a user.').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s=>s.setName('unwhitelist').setDescription('Remove a user from the whitelist.').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s=>s.setName('whitelists').setDescription('List comms whitelists.'))
  .addSubcommand(s=>s.setName('message').setDescription('View or change the checker message.').addStringOption(o=>o.setName('text').setDescription('New message').setRequired(false).setMaxLength(1000)));
const giveawayGroup = new SlashCommandBuilder().setName('giveaway').setDescription('Manage giveaways.')
  .addSubcommand(s=>s.setName('start').setDescription('Start a giveaway.').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true).setMaxLength(200)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration').setRequired(true).setMinValue(1).setMaxValue(10080)))
  .addSubcommand(s=>s.setName('end').setDescription('End a giveaway early.').addStringOption(o=>o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
  .addSubcommand(s=>s.setName('reroll').setDescription('Pick a new winner.').addStringOption(o=>o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)));
const groupGroup = new SlashCommandBuilder().setName('group').setDescription('Roblox group requests.')
  .addSubcommand(s=>s.setName('accept').setDescription('Accept a group request.').addUserOption(o=>o.setName('user').setDescription('Discord member').setRequired(true)))
  .addSubcommand(s=>s.setName('request-lists').setDescription('Show pending requests.'));
const feedbackGroup = new SlashCommandBuilder().setName('staff').setDescription('Staff tools.')
  .addSubcommand(s=>s.setName('feedback').setDescription('Submit staff feedback.').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addIntegerOption(o=>o.setName('rating').setDescription('Rating from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10)).addStringOption(o=>o.setName('comments').setDescription('Comments').setRequired(true).setMaxLength(1000)));
const infractAlias = new SlashCommandBuilder().setName('infract').setDescription('Log a staff infraction.')
  .addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(o=>o.setName('type').setDescription('Infraction type').setRequired(true).addChoices({name:'Warning',value:'Warning'},{name:'Strike',value:'Strike'},{name:'Suspension',value:'Suspension'},{name:'Demotion',value:'Demotion'},{name:'Termination',value:'Termination'},{name:'Under Investigation',value:'Under Investigation'},{name:'Note',value:'Note'}))
  .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
const promoteAlias = new SlashCommandBuilder().setName('promote').setDescription('Log a staff promotion.')
  .addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(o=>o.setName('rank').setDescription('New rank').setRequired(true).setMaxLength(100))
  .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
const mcSlash = new SlashCommandBuilder().setName('mc').setDescription('Show server member count.');
const jsonv2Slash = new SlashCommandBuilder().setName('jsonv2').setDescription('Send a JSON message.')
  .addStringOption(o=>o.setName('json').setDescription('JSON object containing content or embeds').setRequired(true).setMaxLength(4000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const cloneemojiSlash = new SlashCommandBuilder().setName('cloneemoji').setDescription('Clone a custom emoji into this server.')
  .addStringOption(o=>o.setName('emoji').setDescription('Custom emoji mention').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers);
const commands = [say,relink,verifyPanel,getinfo,rid,erlc,ticketPanel,ticketClose,ticketAdd,infraction,promotion,sessionStart,sessionEnd,appPanel,giveawayStart,help,ping,ticketGroup,sessionGroup,commsGroup,giveawayGroup,groupGroup,feedbackGroup,infractAlias,promoteAlias,mcSlash,jsonv2Slash,cloneemojiSlash];

function baseEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(0x247bf1).setTitle(title).setDescription(description)
    .setFooter({ text: 'California State Roleplay | Realism at its Finest' }).setTimestamp();
}
async function logTo(guild: any, channelId: string | undefined, payload: any) {
  if (!channelId) return;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (ch?.isTextBased() && ch.send) await ch.send(payload).catch((e: any) => console.error('Log send failed:', e));
}
function v2Text(...lines: string[]) {
  const c = new ContainerBuilder();
  for (const line of lines) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
  return c;
}
async function bloxlinkLookup(discordId: string, guildId: string) {
  if (!BLOXLINK_API_KEY) throw new Error('BLOXLINK_API_KEY is missing from Render Environment.');
  const url = `https://api.blox.link/v4/public/guilds/${encodeURIComponent(guildId)}/discord-to-roblox/${encodeURIComponent(discordId)}`;
  const res = await fetch(url, { headers: { Authorization: BLOXLINK_API_KEY } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const details = await res.text().catch(() => '');
    console.error('Bloxlink API error', res.status, details.slice(0,300));
    throw new Error(res.status === 401 || res.status === 403 ? 'Bloxlink rejected the API key or it lacks access to this server.' : 'Bloxlink lookup failed. Try again later.');
  }
  const data: any = await res.json();
  const robloxId = data?.robloxID ?? data?.robloxId ?? data?.roblox_id ?? data?.RobloxID ?? data?.roblox?.id;
  if (!robloxId) return null;
  const userRes = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(String(robloxId))}`);
  if (!userRes.ok) throw new Error('Roblox profile lookup failed.');
  const user: any = await userRes.json();
  return { robloxId: String(robloxId), username: user.name || data.robloxUsername || 'Unknown', displayName: user.displayName || user.name || 'Unknown' };
}
async function replyError(interaction: any, error: any) {
  console.error('Command failed:', error);
  const content = error?.message || 'Something went wrong. Check the bot logs and permissions.';
  if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true }).catch(() => {});
  else await interaction.reply({ content, ephemeral: true }).catch(() => {});
}
async function sendVerificationPanel(channel: any) {
  const panel = v2Text('## California State Roleplay — Roblox Verification',
    'Link your Roblox account with **Bloxlink** first. Click **Begin Verification** to check your linked account and receive the server role.',
    'If the wrong Roblox account is linked, use Bloxlink’s account verification flow to change it, then try again.');
  panel.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(VERIFY_BANNER)));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:start').setLabel('Begin Verification').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('verify:help').setLabel('How to Link').setStyle(ButtonStyle.Secondary),
  ));
  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [panel] });
}
async function createTicket(interaction: any, type: string, answers: string[]) {
  const guild = interaction.guild;
  const isIA = type === 'Internal Affairs' || type === 'Report a Player' || type === 'Staff Feedback';
  const parent = isIA ? CFG.categories.highRank : CFG.categories.general;
  const role = isIA ? CFG.roles.highRankSupport : CFG.roles.support;
  const name = `ticket-${type.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,30)}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,12)}`.slice(0,95);
  const channel = await guild.channels.create({
    name, type: ChannelType.GuildText, parent,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ],
  });
  activeTickets.set(channel.id, { opener: interaction.user.id, type });
  const fields = answers.map((answer, i) => ({ name: ['Reason / report','Proof or evidence','Additional information'][i] || `Answer ${i+1}`, value: answer || 'Not provided', inline: false }));
  const embed = baseEmbed(`${type} Ticket`, `Opened by <@${interaction.user.id}>\nPlease remain respectful and provide relevant information.`).addFields(fields);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );
  await channel.send({ content: `<@${interaction.user.id}> <@&${role}>`, embeds: [embed], components: [row], allowedMentions: { users: [interaction.user.id], roles: [role] } });
  await interaction.reply({ content: `Your ticket is open: <#${channel.id}>`, ephemeral: true });
  await logTo(guild, CFG.channels.ticketLogs, { embeds: [baseEmbed('Ticket Opened', `Type: **${type}**\nCreator: <@${interaction.user.id}>\nChannel: <#${channel.id}>`)] });
}
function ticketModal(type: string) {
  const modal = new ModalBuilder().setCustomId(`ticket:modal:${type}`).setTitle(`${type} Ticket`);
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(type === 'Internal Affairs' ? 'Who are you reporting and why?' : 'Reason for opening').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof').setLabel('Proof / evidence (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Additional information (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  return modal;
}
async function erlcRequest(path: string, method = 'GET', body?: any) {
  if (!ERLC_API_KEY) throw new Error('Set ERLC_API in Render Environment.');
  const res = await fetch(`https://api.policeroleplay.community/v1/${path}`, {
    method, headers: { 'server-key': ERLC_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ER:LC API returned HTTP ${res.status}: ${text.slice(0,250)}`);
  try { return JSON.parse(text); } catch { return text; }
}

client.once(Events.ClientReady, async ready => {
  console.log(`CaliRP bot online as ${ready.user.tag}`);
  try {
    if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands.map(c => c.toJSON()) });
    else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
    console.log(`Registered ${commands.length} commands.`);
  } catch (e) { console.error('Slash command registration failed:', e); }
});

client.on(Events.GuildMemberAdd, async member => {
  await logTo(member.guild, CFG.channels.welcome, { embeds: [baseEmbed('Welcome to California State Roleplay!', `Welcome <@${member.id}>! Please read the server rules and complete Roblox verification.`).setThumbnail(member.user.displayAvatarURL())] });
});
client.on(Events.GuildMemberRemove, async member => {
  await logTo(member.guild, CFG.channels.erlcJoinLeave, { embeds: [baseEmbed('Member Left', `**${member.user.tag}** (${member.id}) left the server.`)] });
});
client.on(Events.GuildMemberUpdate, async (_old, member) => {
  if (_old.premiumSinceTimestamp !== member.premiumSinceTimestamp && member.premiumSinceTimestamp) {
    await logTo(member.guild, CFG.channels.boost, { embeds: [baseEmbed('Thank You for Boosting!', `Thank you <@${member.id}> for boosting California State Roleplay!`)] });
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'verify:start') {
        await interaction.deferReply({ ephemeral: true });
        const linked = await bloxlinkLookup(interaction.user.id, interaction.guildId);
        if (!linked) {
          await interaction.editReply({ content: 'I could not find a Roblox account linked to your Discord through Bloxlink. Use Bloxlink to verify/link your account, then click Begin Verification again.' });
          return;
        }
        const profile = `https://www.roblox.com/users/${linked.robloxId}/profile`;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('verify:continue').setLabel('Continue').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('verify:help').setLabel('How to Link').setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply({
          embeds: [baseEmbed('Roblox Account Found', `Linked account: **[${linked.username}](${profile})**\nIf this is correct, click **Continue** to receive the verified role.`)],
          components: [row],
        });
        return;
      }
      if (interaction.customId === 'verify:help') {
        await interaction.reply({ content: 'Open the Bloxlink bot in this server and run its verification/link command. After Bloxlink shows your Roblox account as linked, return here and click **Begin Verification** again.', ephemeral: true });
        return;
      }
      if (interaction.customId === 'verify:continue') {
        await interaction.deferReply({ ephemeral: true });
        if (!VERIFIED_ROLE_ID) { await interaction.editReply({ content: 'Verification roles are not configured. Ask an administrator to set VERIFIED_ROLE_ID in Render.' }); return; }
        const linked = await bloxlinkLookup(interaction.user.id, interaction.guildId);
        if (!linked) { await interaction.editReply({ content: 'Bloxlink could not confirm a linked Roblox account. Link your account first and try again.' }); return; }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add([VERIFIED_ROLE_ID, CITIZEN_ROLE_ID], 'Bloxlink account verification');
        if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) await member.roles.remove(UNVERIFIED_ROLE_ID, 'Bloxlink account verification');
        const profile = `https://www.roblox.com/users/${linked.robloxId}/profile`;
        await interaction.editReply({ content: `Verified successfully as [${linked.username}](${profile}). Welcome to California State Roleplay!` });
        await logTo(interaction.guild, VERIFY_LOG_CHANNEL_ID, { embeds: [baseEmbed('Roblox Account Verified', `Discord: <@${interaction.user.id}> (${interaction.user.id})\nRoblox: [${linked.username}](${profile}) (${linked.robloxId})\nVerified: <t:${Math.floor(Date.now()/1000)}:F>`)] });
        return;
      }
      if (interaction.customId.startsWith('ticket:open:')) {
        await interaction.showModal(ticketModal(interaction.customId.slice('ticket:open:'.length)));
        return;
      }
      if (interaction.customId === 'session:vote') { sessionVotes.add(interaction.user.id); await interaction.reply({content:`Vote recorded (${sessionVotes.size}/${sessionVoteThreshold}).`,ephemeral:true}); if(sessionVotes.size>=sessionVoteThreshold){await logTo(interaction.guild,CFG.channels.sessions,{content:'Session vote passed. Administrators may start the session.'});} return; }
      if (interaction.customId === 'ticket:claim') {
        const ticket = activeTickets.get(interaction.channelId);
        if (!ticket) { await interaction.reply({ content: 'Ticket data was not found. This may be an older ticket.', ephemeral: true }); return; }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.reply({ content: 'Only staff can claim tickets.', ephemeral: true }); return;
        }
        ticket.claimedBy = interaction.user.id;
        await interaction.reply({ content: `Ticket claimed by <@${interaction.user.id}>.` });
        return;
      }
      if (interaction.customId === 'ticket:close-confirm') { const t=activeTickets.get(interaction.channelId); if(!t || t.opener!==interaction.user.id){await interaction.reply({content:'Only the ticket opener can confirm this request.',ephemeral:true});return;} await interaction.reply('Ticket closing in 5 seconds.'); setTimeout(()=>interaction.channel?.delete('Ticket close confirmed').catch(()=>{}),5000); return; }
      if (interaction.customId === 'ticket:close') {
        const ticket = activeTickets.get(interaction.channelId);
        const staff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if (ticket && ticket.opener !== interaction.user.id && !staff) { await interaction.reply({ content: 'Only the ticket opener or staff can close this ticket.', ephemeral: true }); return; }
        await interaction.reply({ content: 'Ticket closing in 5 seconds.' });
        await logTo(interaction.guild, CFG.channels.ticketLogs, { embeds: [baseEmbed('Ticket Closed', `Channel: ${interaction.channel}\nClosed by: <@${interaction.user.id}>`)] });
        setTimeout(() => interaction.channel?.delete('Ticket closed').catch(() => {}), 5000);
        return;
      }
      if (interaction.customId.startsWith('application:')) {
        const kind = interaction.customId.split(':')[1];
        const modal = new ModalBuilder().setCustomId(`application:modal:${kind}`).setTitle(`${kind} Application`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('discord').setLabel('Discord username').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)));
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('experience').setLabel('Why are you applying?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('availability').setLabel('Experience / availability').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
        await interaction.showModal(modal); return;
      }
      if (interaction.customId.startsWith('giveaway:join:')) {
        const id = interaction.customId.split(':')[2];
        const entrants = giveawayEntrants.get(id) || new Set<string>();
        if (entrants.has(interaction.user.id)) { await interaction.reply({ content: 'You are already entered.', ephemeral: true }); return; }
        entrants.add(interaction.user.id); giveawayEntrants.set(id, entrants);
        await interaction.reply({ content: 'You have entered the giveaway!', ephemeral: true }); return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket:modal:')) {
        const type = interaction.customId.slice('ticket:modal:'.length);
        await createTicket(interaction, type, [interaction.fields.getTextInputValue('reason'), interaction.fields.getTextInputValue('proof') || 'Not provided', interaction.fields.getTextInputValue('details') || 'Not provided']);
        return;
      }
      if (interaction.customId.startsWith('application:modal:')) {
        const kind = interaction.customId.slice('application:modal:'.length);
        const embed = baseEmbed(`${kind} Application`, `Applicant: <@${interaction.user.id}> (${interaction.user.id})`).addFields(
          { name: 'Discord username', value: interaction.fields.getTextInputValue('discord') },
          { name: 'Why applying?', value: interaction.fields.getTextInputValue('experience') },
          { name: 'Experience / availability', value: interaction.fields.getTextInputValue('availability') },
        );
        await logTo(interaction.guild, CFG.channels.applicationResults, { embeds: [embed] });
        await interaction.reply({ content: 'Your application has been submitted for staff review.', ephemeral: true });
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;
    switch (interaction.commandName) {
      case 'ticket': {
        const sub=interaction.options.getSubcommand(), ticket=activeTickets.get(interaction.channelId), user=interaction.options.getUser('user');
        if(!ticket && !['add','remove','claim','unclaim','close','close-request'].includes(sub)){await interaction.reply({content:'Use this in a ticket channel.',ephemeral:true});break;}
        const staff=interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)||interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if(sub==='add'){if(!staff){await interaction.reply({content:'Staff only.',ephemeral:true});break;} await interaction.channel.permissionOverwrites.edit(user.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});await interaction.reply(`Added <@${user.id}>.`);}
        else if(sub==='remove'){if(!staff){await interaction.reply({content:'Staff only.',ephemeral:true});break;} await interaction.channel.permissionOverwrites.delete(user.id).catch(()=>{});await interaction.reply(`Removed <@${user.id}>.`);}
        else if(sub==='claim'){if(!staff){await interaction.reply({content:'Staff only.',ephemeral:true});break;}ticket.claimedBy=interaction.user.id;await interaction.reply(`Claimed by <@${interaction.user.id}>.`);}
        else if(sub==='unclaim'){if(!staff){await interaction.reply({content:'Staff only.',ephemeral:true});break;}ticket.claimedBy=undefined;await interaction.reply('Ticket unclaimed.');}
        else if(sub==='close-request'){if(!staff){await interaction.reply({content:'Staff only.',ephemeral:true});break;} const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:close-confirm').setLabel('Confirm close').setStyle(ButtonStyle.Danger)); await interaction.channel.send({content:`<@${ticket.opener}> Staff requested to close this ticket.`,components:[row]});await interaction.reply({content:'Close request sent.',ephemeral:true});}
        else {if(!ticket || (ticket.opener!==interaction.user.id&&!staff)){await interaction.reply({content:'Only the opener or staff can close this ticket.',ephemeral:true});break;}await interaction.reply('Ticket closing in 5 seconds.');setTimeout(()=>interaction.channel?.delete('Ticket closed').catch(()=>{}),5000);}
        break;
      }
      case 'session': {
        const sub=interaction.options.getSubcommand();
        if(sub==='vote'){sessionVoteThreshold=interaction.options.getInteger('votes',true);sessionVotes=new Set();const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('session:vote').setLabel('Vote to start').setStyle(ButtonStyle.Success));await logTo(guild,CFG.channels.sessions,{content:`<@&${CFG.roles.sessionPing}> Session vote started. ${sessionVoteThreshold} votes required.`,components:[row],allowedMentions:{roles:[CFG.roles.sessionPing]}});await interaction.reply({content:'Session vote posted.',ephemeral:true});}
        else {const labels={startup:'Session Started',shutdown:'Session Shutdown',low:'Low Player Count',full:'Server Full'};const desc={startup:'The roleplay session is now starting.',shutdown:'The roleplay session has ended.',low:'The server currently has a low player count. More players are welcome.',full:'The server is currently full. Please wait for an available slot.'};await logTo(guild,CFG.channels.sessions,{content:sub==='startup'? `<@&${CFG.roles.sessionPing}>`:undefined,embeds:[baseEmbed(`CaliRP — ${labels[sub]}`,desc[sub])],allowedMentions:{roles:sub==='startup'?[CFG.roles.sessionPing]:[]}});await interaction.reply({content:`${labels[sub]} announcement sent.`,ephemeral:true});}
        break;
      }
      case 'comms': {
        const sub=interaction.options.getSubcommand(), user=interaction.options.getUser('user');
        if(sub==='whitelist'){if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required.',ephemeral:true});break;}commsWhitelist.add(user.id);await interaction.reply({content:`Added <@${user.id}> to the comms whitelist.`,ephemeral:true});}
        else if(sub==='unwhitelist'){if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required.',ephemeral:true});break;}commsWhitelist.delete(user.id);await interaction.reply({content:`Removed <@${user.id}> from the comms whitelist.`,ephemeral:true});}
        else if(sub==='whitelists'){if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required.',ephemeral:true});break;}await interaction.reply({content:commsWhitelist.size?[...commsWhitelist].map(id=>`• <@${id}> (${id})`).join('\\n'):'No comms whitelist entries.',ephemeral:true});}
        else {if(interaction.options.getString('text')){if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required to change this message.',ephemeral:true});break;}commsMessage=interaction.options.getString('text',true);}await interaction.reply({content:commsMessage,ephemeral:true});}
        break;
      }
      case 'giveaway': {
        const sub=interaction.options.getSubcommand(), id=interaction.options.getString('message_id');
        if(sub==='start'){const prize=interaction.options.getString('prize',true),minutes=interaction.options.getInteger('minutes',true),gid=`${Date.now()}`;giveawayEntrants.set(gid,new Set());const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:join:${gid}`).setLabel('Enter Giveaway').setStyle(ButtonStyle.Success));const msg=await interaction.channel.send({embeds:[baseEmbed('🎉 CaliRP Giveaway',`Prize: **${prize}**\\nHosted by <@${interaction.user.id}>\\nEnds in ${minutes} minutes.`)],components:[row]});giveawayMessages.set(msg.id,{msg,prize,gid,channel:interaction.channel});await interaction.reply({content:`Giveaway started: ${msg.url}`,ephemeral:true});setTimeout(()=>finishGiveaway(msg.id,false).catch(console.error),minutes*60000);}
        else {if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required.',ephemeral:true});break;}const g=giveawayMessages.get(id);if(!g){await interaction.reply({content:'Giveaway not found in this bot session. Restarted giveaways are not recoverable.',ephemeral:true});break;}await finishGiveaway(id,sub==='reroll');await interaction.reply({content:sub==='end'?'Giveaway ended.':'Giveaway rerolled.',ephemeral:true});}
        break;
      }
      case 'group': {
        const sub=interaction.options.getSubcommand();
        if(sub==='request-lists'){if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)){await interaction.reply({content:'High Rank and above only.',ephemeral:true});break;}await interaction.reply({content:groupRequests.length?groupRequests.map((id,i)=>`${i+1}. <@${id}> (${id})`).join('\\n'):'No pending group requests.',ephemeral:true});}
        else {const user=interaction.options.getUser('user',true);if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)){await interaction.reply({content:'Staff and whitelisted members only.',ephemeral:true});break;}const roleId=process.env.GROUP_ACCEPTED_ROLE_ID;if(!roleId){await interaction.reply({content:'Set GROUP_ACCEPTED_ROLE_ID in Render to enable role assignment.',ephemeral:true});break;}const member=await guild.members.fetch(user.id);await member.roles.add(roleId,'Roblox group request accepted');const i=groupRequests.indexOf(user.id);if(i>=0)groupRequests.splice(i,1);await interaction.reply({content:`Accepted <@${user.id}> and assigned the configured group role.`,ephemeral:true});}
        break;
      }

      case 'infract':
      case 'promote': {
        const isInf=interaction.commandName==='infract';
        const user=interaction.options.getUser('user',true), reason=interaction.options.getString('reason',true);
        if(isInf){const type=interaction.options.getString('type',true);const e=baseEmbed(`Staff Infraction — ${type}`,`Target: <@${user.id}>\\nIssued by: <@${interaction.user.id}>\\nReason: ${reason}\\nStatus: Active`);await logTo(guild,CFG.channels.infractions,{embeds:[e]});await logTo(guild,CFG.channels.modLogs,{embeds:[e]});await interaction.reply({content:`Infraction recorded for <@${user.id}>.`,ephemeral:true});}
        else {const rank=interaction.options.getString('rank',true);await logTo(guild,CFG.channels.promotions,{embeds:[baseEmbed('Staff Promotion',`Staff member: <@${user.id}>\\nNew rank: **${rank}**\\nIssued by: <@${interaction.user.id}>\\nReason: ${reason}`)]});await interaction.reply({content:`Promotion recorded for <@${user.id}>.`,ephemeral:true});}
        break;
      }
      case 'mc': await interaction.reply({content:`Server member count: ${guild.memberCount}`}); break;
      case 'jsonv2': {
        if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Administrator permission required.',ephemeral:true});break;}
        try {const data=JSON.parse(interaction.options.getString('json',true));if(!data.content&&!data.embeds)throw new Error();await interaction.channel.send({content:data.content,embeds:data.embeds});await interaction.reply({content:'JSON message sent.',ephemeral:true});}catch{await interaction.reply({content:'Invalid JSON. Provide an object containing content or embeds.',ephemeral:true});}break;
      }
      case 'cloneemoji': {
        const raw=interaction.options.getString('emoji',true),em=raw.match(/<a?:(\\w+):(\\d+)>/);if(!em){await interaction.reply({content:'Provide a custom emoji mention.',ephemeral:true});break;}const ext=raw.startsWith('<a:')?'gif':'png';const emoji=await guild.emojis.create({attachment:`https://cdn.discordapp.com/emojis/${em[2]}.${ext}`,name:em[1]});await interaction.reply({content:`Created emoji <:${emoji.name}:${emoji.id}>.`,ephemeral:true});break;
      }
      case 'staff': {
        const user=interaction.options.getUser('user',true),rating=interaction.options.getInteger('rating',true),comments=interaction.options.getString('comments',true);
        await logTo(guild,CFG.channels.modLogs,{embeds:[baseEmbed('Staff Feedback',`Staff member: <@${user.id}>\\nRating: **${rating}/10**\\nSubmitted by: <@${interaction.user.id}>\\nComments: ${comments}`)]});await interaction.reply({content:'Thank you. Your feedback has been submitted.',ephemeral:true});break;
      }

      case 'say': {
        if (!interaction.channel?.isSendable()) { await interaction.reply({ content: 'Use this in a text channel.', ephemeral: true }); break; }
        await interaction.channel.send({ content: interaction.options.getString('message', true), allowedMentions: { parse: [] } });
        await interaction.reply({ content: 'Message sent.', ephemeral: true }); break;
      }
      case 'relink':
        await interaction.reply({ content: 'To link or change your Roblox account, use the Bloxlink verification command in this server. Once linked, return to the verification panel.', ephemeral: true }); break;
      case 'verification-panel':
        if (!guild || !interaction.channel?.isSendable()) { await interaction.reply({ content: 'Use this in a server text channel.', ephemeral: true }); break; }
        await sendVerificationPanel(interaction.channel); await interaction.reply({ content: 'Verification panel posted.', ephemeral: true }); break;
      case 'getinfo': {
        const user = interaction.options.getUser('user') || interaction.user;
        await interaction.deferReply({ ephemeral: true });
        const linked = await bloxlinkLookup(user.id, interaction.guildId);
        if (!linked) { await interaction.editReply(`No Bloxlink-linked Roblox account found for ${user.tag}.`); break; }
        await interaction.editReply({ embeds: [baseEmbed('Roblox Account', `Discord: <@${user.id}>\nRoblox: [${linked.username}](https://www.roblox.com/users/${linked.robloxId}/profile)\nRoblox ID: ${linked.robloxId}`).setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${linked.robloxId}&width=150&height=150&format=png`)] }); break;
      }
      case 'rid': {
        const query = interaction.options.getString('username', true).trim();
        await interaction.deferReply();
        let userData: any;
        if (/^\d+$/.test(query)) {
          const r = await fetch(`https://users.roblox.com/v1/users/${query}`);
          if (!r.ok) throw new Error('Roblox user ID not found.');
          userData = await r.json();
        } else {
          const r = await fetch('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({usernames:[query], excludeBannedUsers:true}) });
          if (!r.ok) throw new Error('Roblox username lookup failed.');
          const data: any = await r.json(); userData = data.data?.[0];
          if (!userData) throw new Error('Roblox username not found.');
        }
        await interaction.editReply({ embeds: [baseEmbed('Roblox User', `Username: **${userData.name}**\nDisplay name: **${userData.displayName || userData.name}**\nUser ID: **${userData.id}**\n[Open profile](https://www.roblox.com/users/${userData.id}/profile)`)] }); break;
      }
      case 'erlc': {
        await interaction.deferReply({ ephemeral: interaction.options.getSubcommand() === 'command' });
        const sub = interaction.options.getSubcommand();
        if (sub === 'info') {
          const data: any = await erlcRequest('server');
          await interaction.editReply({ embeds: [baseEmbed('ER:LC Server Information', `Name: **${data.Name || 'Unknown'}**\nOwner: **${data.Owner || 'Unknown'}**\nPlayers: **${data.CurrentPlayers ?? 'Unknown'}**\nJoin key: **${data.JoinKey || 'Not available'}**`)] });
        } else if (sub === 'players') {
          const players: any = await erlcRequest('server/players');
          const list = Array.isArray(players) ? players : [];
          await interaction.editReply({ embeds: [baseEmbed('ER:LC Players', list.length ? list.slice(0,40).map((p: any) => `• ${p.Player || p.Name || 'Unknown'} — ${p.Team || 'Unknown team'}`).join('\n') : 'No players found or the server is empty.')] });
        } else {
          const command = interaction.options.getString('command', true).trim();
          const allowed = (process.env.ERLC_ALLOWED_COMMAND_PREFIXES || ':h,:m,:pm,:kick,:ban,:tempban,:unban').split(',').map(s => s.trim().toLowerCase());
          if (!allowed.some(p => command.toLowerCase().startsWith(p + ' ') || command.toLowerCase() === p)) throw new Error('That ER:LC command is not on the allowed list.');
          await erlcRequest('server/command', 'POST', { command });
          await interaction.editReply('Command submitted to the ER:LC API. This does not guarantee the in-game action succeeded.');
          await logTo(guild, CFG.channels.modLogs, { embeds: [baseEmbed('ER:LC Command Submitted', `By: <@${interaction.user.id}>\nCommand: \`${command}\``)] });
        }
        break;
      }
      case 'ticket-panel': {
        const embed = baseEmbed('California State Roleplay — Support', 'Choose the category that best matches your request. Please provide accurate details and evidence when relevant.');
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:open:General Support').setLabel('General Support').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('ticket:open:Internal Affairs').setLabel('Internal Affairs').setStyle(ButtonStyle.Secondary),
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:open:Report a Player').setLabel('Report a Player').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket:open:Staff Feedback').setLabel('Staff Feedback').setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({ embeds: [embed], components: [row1,row2] });
        await interaction.reply({ content: 'Ticket panel posted.', ephemeral: true }); break;
      }
      case 'ticket-close': {
        const ticket = activeTickets.get(interaction.channelId);
        const staff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if (!ticket || (ticket.opener !== interaction.user.id && !staff)) { await interaction.reply({ content: 'Only the ticket opener or staff can close a tracked ticket.', ephemeral: true }); break; }
        await interaction.reply('Ticket closing in 5 seconds.');
        await logTo(guild, CFG.channels.ticketLogs, { embeds: [baseEmbed('Ticket Closed', `Channel: ${interaction.channel}\nClosed by: <@${interaction.user.id}>\nReason: ${interaction.options.getString('reason') || 'Not provided'}`)] });
        setTimeout(() => interaction.channel?.delete('Ticket closed').catch(() => {}), 5000); break;
      }
      case 'ticket-add': {
        if (!interaction.channel || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) { await interaction.reply({ content: 'Staff with Manage Channels can use this command in a ticket.', ephemeral: true }); break; }
        const user = interaction.options.getUser('user', true);
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await interaction.reply({ content: `Added <@${user.id}> to this ticket.` }); break;
      }
      case 'infraction': {
        const user = interaction.options.getUser('user', true), type = interaction.options.getString('type', true), reason = interaction.options.getString('reason', true);
        const embed = baseEmbed(`Staff Infraction — ${type}`, `Target: <@${user.id}> (${user.id})\nIssued by: <@${interaction.user.id}>\nReason: ${reason}\nStatus: Active`);
        await logTo(guild, CFG.channels.infractions, { embeds: [embed] });
        await logTo(guild, CFG.channels.modLogs, { embeds: [embed] });
        await interaction.reply({ content: `Infraction recorded for <@${user.id}>.`, ephemeral: true }); break;
      }
      case 'promotion': {
        const user = interaction.options.getUser('user', true), rank = interaction.options.getString('rank', true), reason = interaction.options.getString('reason', true);
        await logTo(guild, CFG.channels.promotions, { embeds: [baseEmbed('Staff Promotion', `Staff member: <@${user.id}>\nNew rank: **${rank}**\nIssued by: <@${interaction.user.id}>\nReason: ${reason}`)] });
        await interaction.reply({ content: `Promotion recorded for <@${user.id}>.`, ephemeral: true }); break;
      }
      case 'session-start': {
        const host = interaction.options.getString('host') || interaction.user.tag;
        await logTo(guild, CFG.channels.sessions, { content: `<@&${CFG.roles.sessionPing}>`, embeds: [baseEmbed('California State Roleplay — Session Started', `Host: **${host}**\nJoin the server and follow staff instructions.\nER:LC join code: **califorp**`)], allowedMentions: { roles: [CFG.roles.sessionPing] } });
        await interaction.reply({ content: 'Session announcement sent.', ephemeral: true }); break;
      }
      case 'session-end':
        await logTo(guild, CFG.channels.sessions, { embeds: [baseEmbed('Session Ended', `The session has ended. Thank you to everyone who attended.\nEnded by: <@${interaction.user.id}>`)] });
        await interaction.reply({ content: 'Session end announcement sent.', ephemeral: true }); break;
      case 'application-panel': {
        const embed = baseEmbed('California State Roleplay — Applications', 'Choose an application below. Please answer honestly and provide enough detail for the review team.');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('application:Staff').setLabel('Staff Application').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('application:Media').setLabel('Media Application').setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Application panel posted.', ephemeral: true }); break;
      }
      case 'giveaway-start': {
        const prize = interaction.options.getString('prize', true), minutes = interaction.options.getInteger('minutes', true);
        const id = `${Date.now()}`; giveawayEntrants.set(id, new Set());
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:join:${id}`).setLabel('Enter Giveaway').setStyle(ButtonStyle.Success));
        const msg = await interaction.channel.send({ embeds: [baseEmbed('🎉 CSRP Giveaway', `Prize: **${prize}**\nHosted by: <@${interaction.user.id}>\nEnds in: ${minutes} minute(s)\nClick below to enter.`)], components: [row] });
        await interaction.reply({ content: `Giveaway started: ${msg.url}`, ephemeral: true });
        setTimeout(async () => {
          const entries = [...(giveawayEntrants.get(id) || new Set())];
          giveawayEntrants.delete(id);
          const winner = entries.length ? entries[Math.floor(Math.random() * entries.length)] : null;
          await msg.edit({ embeds: [baseEmbed('🎉 Giveaway Ended', winner ? `Prize: **${prize}**\nWinner: <@${winner}>\nEntries: ${entries.length}` : `Prize: **${prize}**\nNo one entered this giveaway.`)], components: [] }).catch(() => {});
          await interaction.channel.send(winner ? `Congratulations <@${winner}>! You won **${prize}**.` : 'The giveaway ended with no entries.').catch(() => {});
        }, minutes * 60_000); break;
      }
      case 'help':
        await interaction.reply({ embeds: [baseEmbed('CaliRP Bot Commands', '`/verification-panel`, `/relink`, `/getinfo`, `/rid`, `/erlc info|players|command`, `/ticket-panel`, `/ticket-close`, `/ticket-add`, `/infraction`, `/promotion`, `/session-start`, `/session-end`, `/application-panel`, `/giveaway-start`, `/say`, `/ping`.')] , ephemeral: true }); break;
      case 'ping':
        await interaction.reply({ content: `Pong! Gateway: ${client.ws.ping}ms.`, ephemeral: true }); break;
    }
  } catch (error) { await replyError(interaction, error); }
});


client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const args=message.content.slice(PREFIX.length).trim().split(/\s+/), cmd=(args.shift()||'').toLowerCase(), member=message.member, guild=message.guild;
  const isAdmin=!!member?.permissions.has(PermissionFlagsBits.Administrator);
  const isHR=!!member?.permissions.has(PermissionFlagsBits.ManageRoles)||isAdmin;
  const isStaff=!!member?.permissions.has(PermissionFlagsBits.ManageMessages)||isHR;
  const reply=(content)=>message.reply({content,allowedMentions:{repliedUser:false}}).catch(()=>{});
  const sendSession=async(title,desc,ping=false)=>logTo(guild,CFG.channels.sessions,{content:ping?`<@&${CFG.roles.sessionPing}>`:undefined,embeds:[baseEmbed(title,desc)],allowedMentions:{roles:ping?[CFG.roles.sessionPing]:[]}});
  if(botBlocked.has(message.author.id)&&!isAdmin)return reply('You are blocked from using this bot.');
  try {
    if(cmd==='verificationpanel'){if(!isAdmin)return reply('Administrator permission required.');await sendVerificationPanel(message.channel);return reply('Verification panel posted.');}
    if(cmd==='ticketpanel'){if(!isAdmin)return reply('Administrator permission required.');const row1=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open:General Support').setLabel('General Support').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('ticket:open:Internal Affairs').setLabel('Internal Affairs').setStyle(ButtonStyle.Secondary));const row2=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open:Report a Player').setLabel('Report a Player').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('ticket:open:Staff Feedback').setLabel('Staff Feedback').setStyle(ButtonStyle.Secondary));await message.channel.send({embeds:[baseEmbed('CaliRP Support','Choose the category that best matches your request.')],components:[row1,row2]});return;}
    if(cmd==='ticketbl'||cmd==='ticketunbl'){if(!isStaff)return reply('Support staff only.');const u=message.mentions.users.first()||await client.users.fetch(args[0]).catch(()=>null);if(!u)return reply('Mention a user or provide a Discord ID.');if(cmd==='ticketbl')ticketBlocked.add(u.id);else ticketBlocked.delete(u.id);return reply(cmd==='ticketbl'?`Blocked <@${u.id}> from opening tickets.`:`Unblocked <@${u.id}> from opening tickets.`);}
    if(cmd==='testidle'){if(!isStaff)return reply('Support staff only.');const raw=args[0]||'2m',m=raw.match(/^(\d+)(s|m|h)$/i);if(!m)return reply('Use a duration such as 30s, 2m, or 1h.');const ms=Number(m[1])*({s:1000,m:60000,h:3600000}[m[2].toLowerCase()]);await reply(`Idle warning test scheduled for ${raw}.`);setTimeout(()=>message.channel.send('⚠️ Ticket inactivity test: please reply if you still need assistance.').catch(()=>{}),ms);return;}
    if(cmd==='sessionpanel'){if(!isAdmin)return reply('Administrators only.');const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('session:vote').setLabel('Vote to start').setStyle(ButtonStyle.Success));await message.channel.send({embeds:[baseEmbed('CaliRP Live Session Panel','Use the button to vote for a session. Administrators can use the session commands to announce status.')],components:[row]});return;}
    if(cmd==='ssv'){if(!isAdmin)return reply('Administrators only.');sessionVoteThreshold=Math.max(1,Number(args[0])||10);sessionVotes=new Set();const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('session:vote').setLabel('Vote to start').setStyle(ButtonStyle.Success));await logTo(guild,CFG.channels.sessions,{content:`<@&${CFG.roles.sessionPing}> Session vote started — ${sessionVoteThreshold} votes required.`,components:[row],allowedMentions:{roles:[CFG.roles.sessionPing]}});return reply('Session vote posted.');}
    if(['ssu','ssd','ssl','ssf'].includes(cmd)){if(!isAdmin)return reply('Administrators only.');const map={ssu:['Session Started','The roleplay session is starting.',true],ssd:['Session Shutdown','The roleplay session has ended.',false],ssl:['Low Player Count','The server has a low player count. Join if available.',false],ssf:['Server Full','The server is currently full.',false]};const x=map[cmd];await sendSession('CaliRP — '+x[0],x[1],x[2]);return reply(x[0]+' announcement sent.');}
    if(cmd==='erlc'){if(!isHR)return reply('High Rank and above only.');if((args[0]||'').toLowerCase()==='info'){const d=await erlcRequest('server');return reply(`Server: ${d.Name||'Unknown'} | Owner: ${d.Owner||'Unknown'} | Players: ${d.CurrentPlayers??'Unknown'} | Join key: ${d.JoinKey||'N/A'}`);}const command=args.join(' ');if(!command)return reply('Usage: -erlc <command> or -erlc info');const allowed=(process.env.ERLC_ALLOWED_COMMAND_PREFIXES||':h,:m,:pm,:kick,:ban,:tempban,:unban').split(',').map(x=>x.trim().toLowerCase());if(!allowed.some(p=>command.toLowerCase()===p||command.toLowerCase().startsWith(p+' ')))return reply('That command is not allowlisted.');await erlcRequest('server/command','POST',{command});await logTo(guild,CFG.channels.modLogs,{embeds:[baseEmbed('ER:LC Command',`By: <@${message.author.id}>\\nCommand: \`${command}\``)]});return reply('Command submitted to ER:LC.');}
    if(cmd==='whitelist'||cmd==='unwhitelist'){if(!isAdmin)return reply('Administrators only.');const u=message.mentions.users.first()||args[0];if(!u)return reply('Mention a user or provide a Discord ID.');const id=typeof u==='string'?u:u.id;if(cmd==='whitelist')liveryWhitelist.add(id);else liveryWhitelist.delete(id);return reply(cmd==='whitelist'?`Added ${id} to the livery whitelist.`:`Removed ${id} from the livery whitelist.`);}
    if(cmd==='gban'||cmd==='gunban'||cmd==='botbl'||cmd==='botunbl'){if(!(process.env.GLOBAL_BAN_ROLE_ID&&member.roles.cache.has(process.env.GLOBAL_BAN_ROLE_ID)))return reply('Global ban role required.');const u=message.mentions.users.first()||await client.users.fetch(args[0]).catch(()=>null);if(!u)return reply('Mention a user or provide a Discord ID.');const block=cmd==='gban'||cmd==='botbl',isBot=cmd==='botbl'||cmd==='botunbl';const set=isBot?botBlocked:ticketBlocked;if(block)set.add(u.id);else set.delete(u.id);const second=process.env.SECOND_GUILD_ID;if(!isBot&&block&&second){const g2=client.guilds.cache.get(second);if(g2)await g2.members.ban(u.id,{reason:`Global ban by ${message.author.tag}`}).catch(()=>{});}if(!isBot&&block)await guild.members.ban(u.id,{reason:`Global ban by ${message.author.tag}`}).catch(()=>{});return reply(`${cmd} applied to <@${u.id}>. Note: blocklists are currently in memory and reset after restart.`);}
    if(cmd==='applicationpanel'){if(!isAdmin)return reply('Administrators only.');const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('application:Staff').setLabel('Staff Application').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('application:Media').setLabel('Media Application').setStyle(ButtonStyle.Secondary));await message.channel.send({embeds:[baseEmbed('CaliRP Applications',applicationsEnabled?'Applications are open.':'Applications are currently closed.')],components:applicationsEnabled?[row]:[]});return;}
    if(cmd==='disableapplications'||cmd==='enableapplications'){if(!isAdmin)return reply('Administrators only.');applicationsEnabled=cmd==='enableapplications';return reply(`Applications ${applicationsEnabled?'enabled':'disabled'}.`);}
    if(cmd==='group'){const sub=(args.shift()||'').toLowerCase();if(sub==='request-lists'){if(!isHR)return reply('High Rank and above only.');return reply(groupRequests.length?groupRequests.map(id=>'<@'+id+'> ('+id+')').join('\\n'):'No pending group requests.');}if(sub==='accept'){if(!isHR)return reply('Staff and whitelisted members only.');const u=message.mentions.users.first()||await client.users.fetch(args[0]).catch(()=>null);if(!u)return reply('Usage: -group accept @user');const roleId=process.env.GROUP_ACCEPTED_ROLE_ID;if(!roleId)return reply('Set GROUP_ACCEPTED_ROLE_ID in Render to enable group role assignment.');await guild.members.fetch(u.id).then(m=>m.roles.add(roleId));const i=groupRequests.indexOf(u.id);if(i>=0)groupRequests.splice(i,1);return reply(`Accepted <@${u.id}> and assigned the group role.`);}}
    if(cmd==='mc'){return reply(`Server member count: ${guild.memberCount}`);}
    if(cmd==='commands'){return reply('Tickets: -ticketpanel, -ticketbl, -ticketunbl, -testidle | Sessions: -ssv, -ssu, -ssd, -ssl, -ssf, -sessionpanel | ER:LC: -erlc, -whitelist, -unwhitelist | Staff: -gban, -gunban, -botbl, -botunbl, /infract, /promote | Applications: -applicationpanel, -disableapplications, -enableapplications | Utility: -mc, -verificationpanel, -purge, -dashboard, -regulation, -testwelcome, -testboost, -testtag, /say, /jsonv2, /cloneemoji.');}
    if(cmd==='purge'){if(!isStaff)return reply('Staff only.');const n=Number(args[0]);if(!Number.isInteger(n)||n<1||n>100)return reply('Usage: -purge <1-100>');const deleted=await message.channel.bulkDelete(n,true);return reply(`Deleted ${deleted.size} messages.`);}
    if(['testwelcome','testboost','testtag'].includes(cmd)){if(!isAdmin)return reply('Administrators only.');const content=cmd==='testwelcome'?'Welcome preview: please read the rules and complete verification.':cmd==='testboost'?'Thank you for boosting California State Roleplay!':'Thank you for supporting California State Roleplay with a server tag!';return reply(content);}
    if(cmd==='dashboard'||cmd==='regulation'){if(!isAdmin)return reply('Administrators only.');const content=cmd==='dashboard'?'## California State Roleplay Dashboard\\nChoose the relevant panel to get started.':'## California State Roleplay Regulations\\nFollow Discord rules, Roblox rules, and all server staff instructions.';return message.channel.send({embeds:[baseEmbed(cmd==='dashboard'?'CaliRP Dashboard':'CaliRP Regulations',content)]});}
    if(cmd==='mc' || cmd==='ping')return reply(`Members: ${guild.memberCount} | Ping: ${client.ws.ping}ms`);
    if(cmd==='say'){if(!isStaff)return reply('Staff only.');return message.channel.send({content:args.join(' '),allowedMentions:{parse:[]}});}
    if(cmd==='jsonv2'){if(!isAdmin)return reply('Administrators only.');try{const data=JSON.parse(args.join(' '));if(data.content||data.embeds)return message.channel.send({content:data.content,embeds:data.embeds});return reply('JSON must contain content or embeds.');}catch{return reply('Provide valid JSON, e.g. {"content":"Hello"}');}}
    if(cmd==='cloneemoji'){if(!isAdmin)return reply('Administrators only.');const em=message.content.match(/<a?:(\\w+):(\\d+)>/);if(!em)return reply('Mention an emoji to clone.');const ext=message.content.includes('<a:')?'gif':'png';const emoji=await guild.emojis.create({attachment:`https://cdn.discordapp.com/emojis/${em[2]}.${ext}`,name:em[1]});return reply(`Created emoji <:${emoji.name}:${emoji.id}>.`);}
    if(cmd==='dashboard'||cmd==='regulation')return;
  } catch(e){console.error('Prefix command failed',e);return reply('Command failed. Check bot logs and confirm permissions/configuration.');}
});

client.on('error', error => console.error('Discord client error:', error));
client.on(Events.Debug, message => console.log('[discord.js debug]', message));
client.on(Events.Warn, message => console.warn('[discord.js warn]', message));
client.on(Events.ShardError, (error, shardId) => console.error(`Discord gateway shard ${shardId} error:`, error));
client.on(Events.ShardDisconnect, (event, shardId) => console.error(`Discord gateway shard ${shardId} disconnected:`, { code: event.code, reason: event.reason, wasClean: event.wasClean }));
client.on(Events.ShardReconnecting, shardId => console.warn(`Discord gateway shard ${shardId} is reconnecting...`));
client.on(Events.ShardReady, (shardId, unavailableGuilds) => console.log(`Discord gateway shard ${shardId} connected.`, { unavailableGuilds: unavailableGuilds?.size ?? 0 }));
client.on(Events.Invalidated, () => console.error('Discord session invalidated. Restart the service and verify the bot token if this repeats.'));
client.once(Events.ClientReady, readyClient => console.log(`Discord bot ready as ${readyClient.user.tag}`));
async function startDiscordBot() {
  console.log('Checking Discord API connectivity and bot token...');
  try {
    const apiCheck = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${TOKEN}` },
      signal: AbortSignal.timeout(12000),
    });
    const apiBody = await apiCheck.text();
    if (!apiCheck.ok) {
      console.error(`Discord API preflight failed with HTTP ${apiCheck.status}:`, apiBody.slice(0, 500));
      throw new Error(`Discord API rejected the bot token or request (HTTP ${apiCheck.status}). Check BOT_TOKEN in Render.`);
    }
    let gatewayInfo: any;
    try { gatewayInfo = JSON.parse(apiBody); } catch { gatewayInfo = {}; }
    console.log('Discord API preflight passed.', {
      gatewayUrl: gatewayInfo.url,
      remainingSessionStarts: gatewayInfo.session_start_limit?.remaining,
      resetAfterMs: gatewayInfo.session_start_limit?.reset_after,
    });
  } catch (error) {
    console.error('Discord API preflight/network check failed:', error);
  }

  console.log('Connecting to Discord gateway...');
  const startupDiagnostic = setTimeout(() => {
    if (!client.isReady()) {
      console.error('STARTUP DIAGNOSTIC: Discord ClientReady has not fired after 25 seconds.', {
        wsStatus: client.ws.status,
        ping: client.ws.ping,
        tokenConfigured: Boolean(TOKEN),
        clientIdConfigured: Boolean(CLIENT_ID),
        guildIdConfigured: Boolean(GUILD_ID),
      });
      console.error('Check the gateway/shard messages above. Confirm BOT_TOKEN is the Bot Token (not the client secret), and that the bot application is the one invited to the server.');
    }
  }, 25000);
  startupDiagnostic.unref?.();

  try {
    await client.login(TOKEN);
    console.log('Discord login() promise resolved; waiting for gateway READY event...');
  } catch (error) {
    console.error('Discord login failed:', error);
    process.exitCode = 1;
  }
}
void startDiscordBot().catch(error => {
  console.error('Fatal bot startup error:', error);
  process.exitCode = 1;
});
