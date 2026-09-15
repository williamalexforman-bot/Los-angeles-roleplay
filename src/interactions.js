const D = require('discord.js');
const { collection } = require('./store');
const { CHANNELS, TYPES, TICKETS } = require('./settings');
const { v2, panel, row, button } = require('./panels');
const { settings, destination, advance, issue } = require('./discipline');
const { openTicket, closeTicket, ticketAccess } = require('./tickets');
const flows = new Map();
function makeFlow(i, data) { const id = require('node:crypto').randomUUID(); flows.set(id, { ...data, actor: i.user.id, guild: i.guildId, expires: Date.now()+900000 }); return id; }
function flow(i, id) {
  const data = flows.get(id);
  if (!data || data.actor !== i.user.id || data.guild !== i.guildId || data.expires < Date.now()) throw new Error('This form expired. Please start again.');
  return data;
}
setInterval(() => { for (const [id, f] of flows) if (f.expires < Date.now()) flows.delete(id); }, 60000).unref();
async function admin(i) {
  const m = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (!m.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required.');
}
function textInput(id, label, required = true, placeholder) {
  const t = new D.TextInputBuilder().setCustomId(id).setLabel(label).setRequired(required).setStyle(id === 'reason' ? D.TextInputStyle.Paragraph : D.TextInputStyle.Short).setMaxLength(id === 'reason' ? 1200 : 200);
  if (placeholder) t.setPlaceholder(placeholder);
  return row(t);
}
async function reasonModal(i, id) {
  const data = flow(i, id);
  const modal = new D.ModalBuilder().setCustomId(`submit:${id}`).setTitle(data.kind === 'promotion' ? 'Promotion Reason' : 'Infraction Details').addComponents(textInput('reason','Reason'));
  if (data.kind === 'infraction') {
    const state = await collection('members').findOne({ _id: `${i.guildId}:${data.userId}` }) || {};
    const required = advance(state, data.type).suspend;
    modal.addComponents(textInput('ends', 'Suspension end (UTC)', required, 'YYYY-MM-DD HH:mm'));
  }
  await i.showModal(modal);
}
async function config(i) {
  await admin(i);
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const s = await settings(i.guildId);
    return i.editReply(v2('Channel Configuration', Object.keys(CHANNELS).map(k => `**${k}:** <#${s[k]}>`).join('\n'), [], true));
  }
  if (sub === 'channel') {
    const key = i.options.getString('destination', true), channel = i.options.getChannel('channel', true);
    if (key === 'tickets' ? channel.type !== D.ChannelType.GuildCategory : ![D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Tickets require a category; other destinations require a text channel.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { [key]: channel.id } }, { upsert: true });
    return i.editReply(v2('Configuration Saved', `**${key}:** <#${channel.id}>`, [], true));
  }
  if (sub === 'ticket-access') {
    const type = i.options.getString('department', true), role = i.options.getRole('role', true);
    if (role.id === i.guildId || role.managed) throw new Error('Choose a staff role, not @everyone or a managed role.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { [`support_${type}`]: role.id } }, { upsert: true });
    return i.editReply(v2('Ticket Access Saved', `New ${TICKETS[type]} tickets will allow <@&${role.id}>. Existing tickets retain their access.`, [], true));
  }
  const type = i.options.getString('panel',true);
  let channel = i.options.getChannel('channel');
  if (!channel) {
    if (type === 'ticket') channel = i.channel;
    else channel = await destination(i.guild, type === 'infraction' ? 'infractions' : 'promotions');
  }
  await channel.send(panel(type));
  return i.editReply(v2('Panel Posted', `Posted in <#${channel.id}>.`, [], true));
}
async function handleInteraction(i) {
  try {
    if (!i.inGuild()) return;
    if (i.isChatInputCommand()) {
      if (i.commandName === 'config') return await config(i);
      if (!['infraction','promotion'].includes(i.commandName)) return;
      await admin(i);
      const data = { kind: i.commandName, userId: i.options.getUser('member',true).id };
      if (data.kind === 'infraction') data.type = i.options.getString('type',true);
      else { data.previous = i.options.getRole('previous-rank',true).id; data.next = i.options.getRole('new-rank',true).id; }
      return await reasonModal(i, makeFlow(i, data));
    }
    if (i.isStringSelectMenu() && i.customId === 'ticket:create') {
      const type = i.values[0]; if (!TICKETS[type]) throw new Error('Repost the ticket panel using /config panel.');
      const modal = new D.ModalBuilder().setCustomId(`ticket-reason:${type}`).setTitle(`${TICKETS[type]} Ticket`).addComponents(textInput('reason','Why do you want to open a ticket?'));
      if (type === 'affairs') modal.addComponents(textInput('reported','Who are you reporting?'),textInput('evidence','Evidence or explanation'));
      return await i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId.startsWith('ticket-reason:')) {
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      const type = i.customId.split(':')[1], reason = i.fields.getTextInputValue('reason').trim();
      if (!reason) throw new Error('A reason is required.');
      const extra = type === 'affairs' ? `Reported: ${i.fields.getTextInputValue('reported')}\nEvidence: ${i.fields.getTextInputValue('evidence')}` : '';
      return await i.editReply(v2('Ticket Created', await openTicket(i, type, reason, extra), [], true));
    }
    if (i.isButton() && i.customId === 'ticket:close') {
      await ticketAccess(i);
      return await i.reply(v2('Close Ticket?', 'The transcript will be saved before the channel is deleted.', [button('ticket:confirm-close','Save Transcript & Close', D.ButtonStyle.Danger)], true));
    }
    if (i.isButton() && i.customId === 'ticket:confirm-close') {
      await i.deferUpdate();
      await closeTicket(i); return;
    }
    if (i.isButton() && i.customId.startsWith('staff:')) {
      await admin(i);
      const kind = i.customId.split(':')[1];
      const id = makeFlow(i, { kind });
      return await i.reply(v2('Select Member', 'Choose the member for this action.', [new D.UserSelectMenuBuilder().setCustomId(`member:${id}`).setPlaceholder('Select member')], true));
    }
    if (i.isUserSelectMenu() && i.customId.startsWith('member:')) {
      await admin(i); const id = i.customId.split(':')[1], f = flow(i,id); f.userId = i.values[0];
      const control = f.kind === 'infraction' ? new D.StringSelectMenuBuilder().setCustomId(`type:${id}`).setPlaceholder('Infraction type').addOptions(TYPES.map(value => ({label:value,value}))) : new D.RoleSelectMenuBuilder().setCustomId(`previous:${id}`).setPlaceholder('Previous rank');
      return await i.update(v2('Action Details', `**Member:** <@${f.userId}>\n${f.kind === 'infraction' ? 'Choose the infraction type.' : 'Select the rank the member currently holds.'}`, [control], true));
    }
    if (i.isStringSelectMenu() && i.customId.startsWith('type:')) {
      await admin(i); const id=i.customId.split(':')[1]; flow(i,id).type=i.values[0]; return await reasonModal(i,id);
    }
    if (i.isRoleSelectMenu() && i.customId.startsWith('previous:')) {
      await admin(i); const id=i.customId.split(':')[1]; flow(i,id).previous=i.values[0];
      return await i.update(v2('New Rank','Choose the rank the member should receive.',[new D.RoleSelectMenuBuilder().setCustomId(`next:${id}`).setPlaceholder('New rank')],true));
    }
    if (i.isRoleSelectMenu() && i.customId.startsWith('next:')) {
      await admin(i); const id=i.customId.split(':')[1]; flow(i,id).next=i.values[0]; return await reasonModal(i,id);
    }
    if (i.isModalSubmit() && i.customId.startsWith('submit:')) {
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      await admin(i); const id=i.customId.split(':')[1], f=flow(i,id);
      if (f.submitting) throw new Error('This form has already been submitted.');
      const reason=i.fields.getTextInputValue('reason').trim(); if (!reason) throw new Error('A reason is required.');
      f.submitting=true;
      try {
        const result=await issue(i,f,reason,f.kind === 'infraction' ? i.fields.getTextInputValue('ends').trim() : '');
        flows.delete(id); return await i.editReply(v2('Action Recorded',result,[],true));
      } catch(e) { flows.delete(id); throw e; }
    }
  } catch(e) {
    console.error('Interaction failed:', e.code || e.name);
    const message = e.name === 'Error' ? e.message : 'Discord could not complete this action. Check the bot’s channel and role permissions.';
    const payload = v2('Action Not Completed',message,[],true);
    if (i.deferred || i.replied) await i.editReply(payload).catch(() => {});
    else await i.reply(payload).catch(() => {});
  }
}
module.exports = { handleInteraction, textInput };
