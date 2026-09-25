const { ticketNotice } = require('./legacy-layout');
const D = require('discord.js');
const { collection, locked } = require('./store');
const { settings, destination } = require('./discipline');
const { TICKETS, TICKET_ACCESS_ROLE } = require('./settings');
const { v2, button } = require('./panels');
async function ensureOpeningPanel(channel, record, newlyCreated = false) {
  return locked(`ticket-close:${record._id}`, async () => {
    let message;
    if(record.panelId) message=await channel.messages.fetch(record.panelId).catch(e=>{if(e.code===10008)return null;throw e;});
    if(!message && !newlyCreated) {
      let before;
      for (;;) {
        const page=await channel.messages.fetch({limit:100,...(before?{before}:{})});
        message=page.find(m=>m.author?.id===channel.client.user.id && JSON.stringify(m.components.map(c=>c.toJSON())).includes('ticket:close'));
        if(message || page.size<100)break;
        before=page.last().id;
      }
    }
    const delivery=await require('./ticket-panel-delivery').deliver(channel,record,message);
    message=delivery.message;
    await collection('tickets').updateOne({_id:record._id},{$set:{panelId:message.id,panelPending:false,emojiFallback:delivery.emojiFallback},$unset:{panelErrorCode:''}});
    return message;
  });
}
async function openTicket(i, type, reason, extra = '') {
  if (!TICKETS[type]) throw new Error('Invalid ticket department.');
  return locked(`ticket:${i.guildId}:${i.user.id}`, async () => {
    const config = await settings(i.guildId);
    const previous = await collection('tickets').findOne({ guildId: i.guildId, owner: i.user.id, status: 'open' });
    if (previous) {
      const channel = await i.guild.channels.fetch(previous._id).catch(e => { if(e.code===10003) return null; throw e; });
      if (channel) {
        try { await ensureOpeningPanel(channel, previous); } catch(e) { console.error('Existing ticket panel repair pending:',channel.id,e.code||e.name); }
        return `You already have an open ticket: <#${channel.id}>.`;
      }
      await collection('tickets').updateOne({ _id: previous._id }, { $set: { status: 'missing' } });
    }
    const category = await ticketCategory(i.guild,config,type);
    const me = await i.guild.members.fetchMe();
    if (!me.permissions.has(D.PermissionFlagsBits.ManageChannels)) throw new Error('The bot needs Manage Channels to create tickets.');
    const support = config[`support_${type}`] || config.role_management;
    const allow = [D.PermissionFlagsBits.ViewChannel, D.PermissionFlagsBits.SendMessages, D.PermissionFlagsBits.ReadMessageHistory, D.PermissionFlagsBits.AttachFiles, D.PermissionFlagsBits.EmbedLinks];
    const overwrites = [ { id: i.guildId, type: D.OverwriteType.Role, deny: [D.PermissionFlagsBits.ViewChannel] }, { id: i.user.id, type: D.OverwriteType.Member, allow }, { id: me.id, type: D.OverwriteType.Member, allow: [...allow, D.PermissionFlagsBits.ManageChannels] } ];
    if (support && support !== TICKET_ACCESS_ROLE) {
      const role = await i.guild.roles.fetch(support);
      if (!role || role.id === i.guildId) throw new Error('The configured ticket support role is invalid.');
      overwrites.push({ id: support, type: D.OverwriteType.Role, allow });
    }
    const channel = await i.guild.channels.create({ name: require('./ticket-format').ticketName(reason,i.user.id), type: D.ChannelType.GuildText, parent: category?.id || null, topic: `ticket-owner:${i.user.id}`, permissionOverwrites: overwrites });
    const record={ _id:channel.id, guildId:i.guildId, owner:i.user.id, type, reason, extra, support, status:'open', opened:Date.now(), panelPending:true };
    try { await collection('tickets').insertOne(record); }
    catch(error) { await channel.delete('Ticket record could not be saved').catch(()=>{}); throw error; }
    try { await ensureOpeningPanel(channel,record,true); }
    catch(error) {
      console.error('Ticket opening panel pending:',channel.id,error.code||error.name);
      await collection('tickets').updateOne({_id:channel.id},{$set:{panelPending:true,panelErrorCode:String(error.code||error.name)}}).catch(()=>{});
      return `Your ticket was created: <#${channel.id}>. Its opening panel could not be posted yet; the bot will retry automatically.`;
    }
    if(/fast\s*pass/i.test(`${reason} ${extra}`))await channel.send(require('./workflows').requestPanel('fastpass')).catch(e=>console.error('Fast Pass form delivery pending:',channel.id,e.code||e.name));
    await require('./logging').record('tickets',i.guildId,'Ticket Opened',`**Ticket:** <#${channel.id}>\n**Opener:** <@${i.user.id}>\n**Department:** ${TICKETS[type]}`,`open:${channel.id}`).catch(()=>{});
    return `Your ${TICKETS[type]} ticket is ready: <#${channel.id}>.`;
  });
}
async function ticketAccess(i) {
  const record = await collection('tickets').findOne({ _id: i.channelId, status: 'open' });
  if (!record) throw new Error('This is not an open ticket.');
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (i.user.id !== record.owner && !member.permissions.has(D.PermissionFlagsBits.Administrator) && !(record.support && member.roles.cache.has(record.support))) throw new Error('Only the requester or this department’s support staff can close the ticket.');
  return record;
}
async function removeFromTicket(i,userId){
  const record=await collection('tickets').findOne({_id:i.channelId,status:'open'});
  if(!record)throw new Error('This command can only be used inside an open ticket.');
  const actor=await i.guild.members.fetch({user:i.user.id,force:true});
  if(!actor.permissions.has(D.PermissionFlagsBits.Administrator)&&!(record.support&&actor.roles.cache.has(record.support)))throw new Error('Only ticket support staff or an administrator can remove someone from a ticket.');
  const target=await i.guild.members.fetch({user:userId,force:true});
  if(target.permissions.has(D.PermissionFlagsBits.Administrator)||target.id===i.guild.ownerId)throw new Error('Discord does not allow channel overwrites to hide a channel from the server owner or an Administrator.');
  const me=await i.guild.members.fetchMe();
  if(target.id===me.id)throw new Error('The bot cannot remove itself from the ticket.');
  if(!me.permissions.has(D.PermissionFlagsBits.ManageChannels))throw new Error('The bot needs Manage Channels to remove someone from a ticket.');
  await i.channel.permissionOverwrites.edit(target.id,{ViewChannel:false,SendMessages:false,ReadMessageHistory:false},{type:D.OverwriteType.Member,reason:`Removed from ticket by ${i.user.id}`});
  await collection('tickets').updateOne({_id:record._id},{$addToSet:{removedUsers:target.id}});
  await require('./logging').record('tickets',i.guildId||i.guild.id,'Member Removed From Ticket',`**Ticket:** <#${i.channelId}>\n**Removed member:** <@${target.id}>\n**Removed by:** <@${i.user.id}>`,`${i.id||i.sourceMessageId}:remove:${target.id}`).catch(()=>{});
  return `<@${target.id}> can no longer view or use this ticket.`;
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
      const payload = v2('Saved Ticket Transcript', `**Ticket ID:** ${i.channelId}\n**Department:** ${TICKETS[record.type]}\n**Opened by:** <@${record.owner}>\n**Transcript part:** ${n + 1}/${parts.length}`);
      payload.components[0].addFileComponents(new D.FileBuilder().setURL(`attachment://${name}`));
      await log.send({ ...payload, files: [new D.AttachmentBuilder(Buffer.from(parts[n]), { name })] });
    }
    await collection('tickets').updateOne({ _id: i.channelId }, { $set: { transcriptSaved: Date.now() } });
    await i.channel.send({content:`${require('./panel-emojis').icon('close','🔒',i.guildId)} Closing Ticket`,allowedMentions:{parse:[]}});
    await new Promise(resolve => setTimeout(resolve, 10000));
    await i.channel.delete(`Ticket closed by ${i.user.id}; transcript saved`);
    await collection('tickets').updateOne({ _id: i.channelId }, { $set: { status: 'closed', closed: Date.now() } });
    await require('./logging').record('tickets',i.guildId,'Ticket Closed',`**Ticket ID:** ${i.channelId}\n**Closed by:** <@${i.user.id}>`,`close:${i.channelId}`).catch(()=>{});
  });
}
module.exports = { recoverTicketPanels, ensureOpeningPanel, syncTicketAccess, ticketAction, openTicket, ticketAccess, removeFromTicket, closeTicket, transcriptLine };

async function ticketAction(i, action) {
  return locked(`ticket-close:${i.channelId}`, async () => {
    const record = await ticketAccess(i);
    const member = await i.guild.members.fetch({user:i.user.id,force:true});
    if (!member.permissions.has(D.PermissionFlagsBits.Administrator) && !(record.support && member.roles.cache.has(record.support))) throw new Error('Only ticket staff can claim or escalate tickets.');
    if (action === 'claim') {
      if (record.claimedBy) return `This ticket is already claimed by <@${record.claimedBy}>.`;
      await collection('tickets').updateOne({_id:record._id},{$set:{claimedBy:i.user.id}});
      await require('./logging').record('claims',i.guildId,'Ticket Claimed',`**Ticket:** <#${i.channelId}>\n**Requester:** <@${record.owner}>\n**Claimed by:** <@${i.user.id}>`,i.id);
      const message = await i.channel.messages.fetch(record.panelId || i.message.id);
      await message.edit(ticketNotice({...record,claimedBy:i.user.id}));
      return 'Ticket claimed.';
    }
    if(action !== 'escalate') throw new Error('Unknown ticket action.');
    return require('./ticket-escalation').escalate(i,record);
  });
}
async function syncTicketAccess(client) {
  for (const guild of client.guilds.cache.values()) {
    if(process.env.GUILD_ID?.trim() && guild.id!==process.env.GUILD_ID.trim())continue;
    try {
      const config = await settings(guild.id);
      const permission = { ViewChannel:true, SendMessages:true, ReadMessageHistory:true, AttachFiles:true, EmbedLinks:true };
      const records = await collection('tickets').find({guildId:guild.id,status:'open'}).toArray();
      for (const record of records) {
        try {
          const channel = await guild.channels.fetch(record._id);
          if(record.support) await channel.permissionOverwrites.edit(record.support,permission,{type:D.OverwriteType.Role});
          await ensureOpeningPanel(channel,record);
        } catch(e) { console.error('Ticket access refresh pending:', record._id,e.code || e.name); }
      }
    } catch(e) { console.error('Shared ticket role refresh pending:',guild.id,e.code || e.name); }
  }
}

async function recoverTicketPanels(client) {
  const records=await collection('tickets').find({status:'open',$or:[{panelPending:true},{panelId:{$exists:false}}]}).toArray();
  for(const record of records){
    try {
      const guild=await client.guilds.fetch(record.guildId);
      const channel=await guild.channels.fetch(record._id);
      if(!channel){await collection('tickets').updateOne({_id:record._id,status:'open'},{$set:{status:'missing'}});continue;}
      await ensureOpeningPanel(channel,record);
    }catch(e){
      if(e.code===10003)await collection('tickets').updateOne({_id:record._id,status:'open'},{$set:{status:'missing'}});
      else {console.error('Opening panel retry pending:',record._id,e.code||e.name);await collection('tickets').updateOne({_id:record._id},{$set:{panelErrorCode:String(e.code||e.name)}}).catch(()=>{});}
    }
  }
}

// Text destinations route private tickets into their parent category. Never inherit public access.
async function ticketCategory(guild,config,type){
 const id=config['tickets_'+type] || config.tickets;
 if(!id)throw new Error('Set the ticket destination with /config channel.');
 const destination=await guild.channels.fetch(id);
 if(destination?.type===D.ChannelType.GuildCategory)return destination;
 if(destination?.type===D.ChannelType.GuildText)return destination.parent || null;
 throw new Error('The ticket destination must be a category or a server text channel.');
}
module.exports.ticketCategory=ticketCategory;
