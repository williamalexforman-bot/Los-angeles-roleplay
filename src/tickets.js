const D = require('discord.js');
const { collection, locked } = require('./store');
const { settings, destination } = require('./discipline');
const { TICKETS } = require('./settings');
const { v2, button } = require('./panels');
async function openTicket(i, type, reason, extra = '') {
  if (!TICKETS[type]) throw new Error('Invalid ticket department.');
  return locked(`ticket:${i.guildId}:${i.user.id}`, async () => {
    const config = await settings(i.guildId);
    const previous = await collection('tickets').findOne({ guildId: i.guildId, owner: i.user.id, status: 'open' });
    if (previous) {
      const channel = await i.guild.channels.fetch(previous._id).catch(() => null);
      if (channel) return `You already have an open ticket: <#${channel.id}>.`;
      await collection('tickets').updateOne({ _id: previous._id }, { $set: { status: 'missing' } });
    }
    const category = await i.guild.channels.fetch(config.tickets);
    if (category?.type !== D.ChannelType.GuildCategory) throw new Error('The configured ticket destination must be a category. Use /config channel destination:tickets to select it.');
    const me = await i.guild.members.fetchMe();
    if (!me.permissions.has(D.PermissionFlagsBits.ManageChannels)) throw new Error('The bot needs Manage Channels to create tickets.');
    const support = config[`support_${type}`];
    const allow = [D.PermissionFlagsBits.ViewChannel, D.PermissionFlagsBits.SendMessages, D.PermissionFlagsBits.ReadMessageHistory, D.PermissionFlagsBits.AttachFiles, D.PermissionFlagsBits.EmbedLinks];
    const overwrites = [ { id: i.guildId, deny: [D.PermissionFlagsBits.ViewChannel] }, { id: i.user.id, allow }, { id: me.id, allow: [...allow, D.PermissionFlagsBits.ManageChannels] } ];
    if (support) {
      const role = await i.guild.roles.fetch(support);
      if (!role || role.id === i.guildId) throw new Error('The configured ticket support role is invalid.');
      overwrites.push({ id: support, allow });
    }
    const channel = await i.guild.channels.create({ name: `${type}-${i.user.id}`, type: D.ChannelType.GuildText, parent: category.id, topic: `ticket-owner:${i.user.id}`, permissionOverwrites: overwrites });
    try {
      await collection('tickets').insertOne({ _id: channel.id, guildId: i.guildId, owner: i.user.id, type, reason, extra, support, status: 'open', opened: Date.now() });
      await channel.send(v2(`${TICKETS[type]} Ticket`, `**Opened by:** <@${i.user.id}>\n**Reason:** ${D.escapeMarkdown(reason)}${extra ? '\n' + D.escapeMarkdown(extra) : ''}\n\nPlease wait for assistance.`, [button('ticket:close', 'Close Ticket', D.ButtonStyle.Danger)]));
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
  if (i.user.id !== record.owner && !member.permissions.has(D.PermissionFlagsBits.Administrator) && !(record.support && member.roles.cache.has(record.support))) throw new Error('Only the requester or this department’s support staff can close the ticket.');
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
    await i.channel.delete(`Ticket closed by ${i.user.id}; transcript saved`);
    await collection('tickets').updateOne({ _id: i.channelId }, { $set: { status: 'closed', closed: Date.now() } });
  });
}
module.exports = { openTicket, ticketAccess, closeTicket, transcriptLine };
