const { ticketNotice } = require('./legacy-layout');
const D = require('discord.js');
const { collection, locked } = require('./store');
const { settings, destination } = require('./discipline');
const { TICKETS, TICKET_ACCESS_ROLE } = require('./settings');
const { v2, button } = require('./panels');
async function openTicket(i, type, reason, extra = '') {
  if (!TICKETS[type]) throw new Error('Invalid ticket department.');
  return locked(`ticket:${i.guildId}:${i.user.id}`, async () => {
    const config = await settings(i.guildId);
    const previous = await collection('tickets').findOne({ guildId: i.guildId, owner: i.user.id, status: 'open' });
    if (previous) {
      const channel = await i.guild.channels.fetch(previous._id).catch(e => { if(e.code===10003) return null; throw e; });
      if (channel) return `You already have an open ticket: <#${channel.id}>.`;
      await collection('tickets').updateOne({ _id: previous._id }, { $set: { status: 'missing' } });
    }
    const category = await i.guild.channels.fetch(config.tickets);
    if (category?.type !== D.ChannelType.GuildCategory) throw new Error('The configured ticket destination must be a category. Use /config channel destination:tickets to select it.');
    const me = await i.guild.members.fetchMe();
    if (!me.permissions.has(D.PermissionFlagsBits.ManageChannels)) throw new Error('The bot needs Manage Channels to create tickets.');
    const support = config[`support_${type}`];
    const allow = [D.PermissionFlagsBits.ViewChannel, D.PermissionFlagsBits.SendMessages, D.PermissionFlagsBits.ReadMessageHistory, D.PermissionFlagsBits.AttachFiles, D.PermissionFlagsBits.EmbedLinks];
    const overwrites = [ { id: i.guildId, type: D.OverwriteType.Role, deny: [D.PermissionFlagsBits.ViewChannel] }, { id: i.user.id, type: D.OverwriteType.Member, allow }, { id: me.id, type: D.OverwriteType.Member, allow: [...allow, D.PermissionFlagsBits.ManageChannels] } ];
    const sharedRole = await i.guild.roles.fetch(TICKET_ACCESS_ROLE);
    if (!sharedRole) throw new Error('The shared ticket access role is missing from this server.');
    overwrites.push({ id: TICKET_ACCESS_ROLE, type: D.OverwriteType.Role, allow });
    if (support && support !== TICKET_ACCESS_ROLE) {
      const role = await i.guild.roles.fetch(support);
      if (!role || role.id === i.guildId) throw new Error('The configured ticket support role is invalid.');
      overwrites.push({ id: support, type: D.OverwriteType.Role, allow });
    }
    const channel = await i.guild.channels.create({ name: `${type}-${i.user.id}`, type: D.ChannelType.GuildText, parent: category.id, topic: `ticket-owner:${i.user.id}`, permissionOverwrites: overwrites });
    try {
      await collection('tickets').insertOne({ _id: channel.id, guildId: i.guildId, owner: i.user.id, type, reason, extra, support, status: 'open', opened: Date.now() });
      const notice = await channel.send(ticketNotice({ type, owner: i.user.id, reason, extra }));
      await collection('tickets').updateOne({ _id: channel.id }, { $set: { panelId: notice.id } });
    } catch (error) {
      await channel.delete('Ticket creation did not complete').catch(() => {});
      await collection('tickets').updateOne({ _id: channel.id }, { $set: { status: 'failed' } });
      throw error;
    }
    return `Your ${TICKETS[type]} ticket is ready: <#${channel.id}>.`;
  });
}
async function ticketAccess(i) {
  const record = await collection('tickets').findOne({ _id: i.channelId, status: 'open' });
  if (!record) throw new Error('This is not an open ticket.');
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (i.user.id !== record.owner && !member.permissions.has(D.PermissionFlagsBits.Administrator) && !member.roles.cache.has(TICKET_ACCESS_ROLE) && !(record.support && member.roles.cache.has(record.support))) throw new Error('Only the requester or this department’s support staff can close the ticket.');
  return record;
}
function transcriptLine(m) {
  const parts = [`[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || 'Unknown'} (${m.author?.id || '?'})`, m.content || ''];
  for (const a of m.attachments.values()) parts.push(`Attachment: ${a.url}`);
  if (m.embeds.length) parts.push(JSON.stringify(m.embeds.map(e => e.toJSON())));
  if (m.components.length) parts.push(JSON.stringify(m.components.map(c => c.toJSON())));
  return parts.join('\n');
}
async function closeTicket(i) {
  return locked(`ticket-close:${i.channelId}`, async () => {
    const record = await ticketAccess(i);
    const log = await destination(i.guild, 'transcripts');
    const me = await i.guild.members.fetchMe();
    if (!i.channel.permissionsFor(me)?.has([D.PermissionFlagsBits.ReadMessageHistory, D.PermissionFlagsBits.ManageChannels]) || !log.permissionsFor(me)?.has(D.PermissionFlagsBits.AttachFiles)) throw new Error('The bot needs Read Message History, Manage Channels and transcript-channel Attach Files permission.');
    const messages = [];
    let before;
    for (;;) {
      const page = await i.channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!page.size) break;
      messages.push(...page.values()); before = page.last().id;
    }
    messages.sort((a,b) => a.createdTimestamp - b.createdTimestamp);
    const header = `Ticket ${i.channelId}\nDepartment: ${TICKETS[record.type]}\nOwner: ${record.owner}\nReason: ${record.reason}\n${record.extra || ''}\nClosed by: ${i.user.id}\n\n`;
    const text = header + messages.map(transcriptLine).join('\n\n');
    // Small parts stay under Discord attachment limits; deletion only follows
    // successful delivery of every part. UTF-8 characters are never split.
    const parts = []; let part = '';
    for (const line of text.split('\n')) {
      if (Buffer.byteLength(part + line) > 4 * 1024 * 1024) { parts.push(part); part = ''; }
      part += line + '\n';
    }
    if (part) parts.push(part);
    for (let n = 0; n < parts.length; n++) {
      const name = `ticket-${i.channelId}-${n+1}.txt`;
      const payload = v2('Ticket Transcript', `**Ticket:** ${i.channelId}\n**Department:** ${TICKETS[record.type]}\n**Requester:** <@${record.owner}>\n**Part:** ${n + 1}/${parts.length}`);
      payload.components[0].addFileComponents(new D.FileBuilder().setURL(`attachment://${name}`));
      await log.send({ ...payload, files: [new D.AttachmentBuilder(Buffer.from(parts[n]), { name })] });
    }
    await collection('tickets').updateOne({ _id: i.channelId }, { $set: { transcriptSaved: Date.now() } });
    await i.channel.send(v2('<:closing_ticket:1549440281638600854> Closing Ticket', 'This ticket will close in 10 seconds.'));
    await new Promise(resolve => setTimeout(resolve, 10000));
    await i.channel.delete(`Ticket closed by ${i.user.id}; transcript saved`);
    await collection('tickets').updateOne({ _id: i.channelId }, { $set: { status: 'closed', closed: Date.now() } });
  });
}
module.exports = { syncTicketAccess, ticketAction, openTicket, ticketAccess, closeTicket, transcriptLine };

async function ticketAction(i, action) {
  return locked(`ticket-close:${i.channelId}`, async () => {
    const record = await ticketAccess(i);
    const member = await i.guild.members.fetch({user:i.user.id,force:true});
    if (!member.permissions.has(D.PermissionFlagsBits.Administrator) && !member.roles.cache.has(TICKET_ACCESS_ROLE) && !(record.support && member.roles.cache.has(record.support))) throw new Error('Only ticket staff can claim or escalate tickets.');
    if (action === 'claim') {
      if (record.claimedBy) return `This ticket is already claimed by <@${record.claimedBy}>.`;
      await collection('tickets').updateOne({_id:record._id},{$set:{claimedBy:i.user.id}});
      const message = await i.channel.messages.fetch(record.panelId || i.message.id);
      await message.edit(ticketNotice({...record,claimedBy:i.user.id}));
      return 'Ticket claimed.';
    }
    const config = await settings(i.guildId);
    if (config.support_high && config.support_high !== TICKET_ACCESS_ROLE) {
      await i.channel.permissionOverwrites.edit(config.support_high,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
    }
    await collection('tickets').updateOne({_id:record._id},{$set:{type:'high',escalatedBy:i.user.id}});
    const message = await i.channel.messages.fetch(record.panelId || i.message.id);
    await message.edit(ticketNotice({...record,type:'high'}));
    await i.channel.send(v2('Ticket Escalated',`This ticket was escalated to High Rank by <@${i.user.id}>.`));
    return 'Ticket escalated to High Rank.';
  });
}
async function syncTicketAccess(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const config = await settings(guild.id);
      const category = await guild.channels.fetch(config.tickets);
      const permission = { ViewChannel:true, SendMessages:true, ReadMessageHistory:true, AttachFiles:true, EmbedLinks:true };
      await category.permissionOverwrites.edit(TICKET_ACCESS_ROLE,permission);
      const records = await collection('tickets').find({guildId:guild.id,status:'open'}).toArray();
      for (const record of records) {
        try {
          const channel = await guild.channels.fetch(record._id);
          await channel.permissionOverwrites.edit(TICKET_ACCESS_ROLE,permission);
          let panelMessage;
          if(record.panelId) panelMessage=await channel.messages.fetch(record.panelId).catch(()=>null);
          if(!panelMessage) {
            const recent=await channel.messages.fetch({limit:100});
            panelMessage=recent.find(m=>m.author?.id===client.user.id && JSON.stringify(m.components.map(c=>c.toJSON())).includes('ticket:close'));
          }
          if(panelMessage) { await panelMessage.edit(ticketNotice(record)); await collection('tickets').updateOne({_id:record._id},{$set:{panelId:panelMessage.id}}); }
        } catch(e) { console.error('Ticket access refresh pending:', record._id,e.code || e.name); }
      }
    } catch(e) { console.error('Shared ticket role refresh pending:',guild.id,e.code || e.name); }
  }
}
