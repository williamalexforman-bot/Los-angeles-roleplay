// @ts-nocheck
import 'dotenv/config';
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
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent],
});
const rest = new REST({ version: '10' }).setToken(TOKEN);
const activeTickets = new Map<string, { opener: string; claimedBy?: string; type: string }>();
const giveawayEntrants = new Map<string, Set<string>>();

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

const commands = [say,relink,verifyPanel,getinfo,rid,erlc,ticketPanel,ticketClose,ticketAdd,infraction,promotion,sessionStart,sessionEnd,appPanel,giveawayStart,help,ping];

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
        await member.roles.add(VERIFIED_ROLE_ID, 'Bloxlink account verification');
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
  const [command] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  if (command?.toLowerCase() === 'verificationpanel' && message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await sendVerificationPanel(message.channel).catch(e => console.error('Prefix verification panel failed:', e));
    await message.reply('Verification panel posted.').catch(() => {});
  }
});

client.on('error', error => console.error('Discord client error:', error));
client.login(TOKEN).catch(error => { console.error('Discord login failed:', error); process.exitCode = 1; });
