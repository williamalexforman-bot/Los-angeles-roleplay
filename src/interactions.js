const { shiftPanel, handleShift } = require('./shifts');
const D = require('discord.js');
const { collection } = require('./store');
const { CHANNELS, TYPES, TICKETS } = require('./settings');
const { v2, panel, row, button } = require('./panels');
const { settings, destination, advance, issue, endSuspension } = require('./discipline');
const { openTicket, closeTicket, ticketAccess, ticketAction } = require('./tickets');
async function admin(i) {
  const m = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (!m.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required.');
}
function textInput(id, label, required = true, placeholder) {
  const t = new D.TextInputBuilder().setCustomId(id).setLabel(label).setRequired(required).setStyle(id === 'reason' ? D.TextInputStyle.Paragraph : D.TextInputStyle.Short).setMaxLength(id === 'reason' ? 1200 : 200);
  if (placeholder) t.setPlaceholder(placeholder);
  return row(t);
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
  if (sub === 'shift-role') {
    const role = i.options.getRole('role', true);
    if (role.id === i.guildId || role.managed) throw new Error('Choose a staff role, not @everyone or a managed role.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { shiftRole: role.id } }, { upsert: true });
    return i.editReply(v2('Shift Access Saved', `Staff with <@&${role.id}> can start shifts.`, [], true));
  }
  if (sub === 'ticket-access') {
    const type = i.options.getString('department', true), role = i.options.getRole('role', true);
    if (role.id === i.guildId || role.managed) throw new Error('Choose a staff role, not @everyone or a managed role.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { [`support_${type}`]: role.id } }, { upsert: true });
    return i.editReply(v2('Ticket Access Saved', `New ${TICKETS[type]} tickets will allow <@&${role.id}>. Existing tickets retain their access.`, [], true));
  }
  const type = i.options.getString('panel',true);
  if (!['ticket','shift'].includes(type)) throw new Error('Use /infraction issue or /promotion issue. Those do not have launcher panels.');
  let channel = i.options.getChannel('channel');
  if (!channel) {
    if (type === 'ticket' || type === 'shift') channel = i.channel;
    else channel = await destination(i.guild, type === 'infraction' ? 'infractions' : 'promotions');
  }
  await channel.send(type === 'shift' ? shiftPanel() : panel(type));
  return i.editReply(v2('Panel Posted', `Posted in <#${channel.id}>.`, [], true));
}
async function handleInteraction(i) {
  try {
    if (!i.inGuild()) return;
    if (i.isButton() && i.customId.startsWith('shift:')) return await handleShift(i, i.customId.split(':')[1]);
    if (i.isChatInputCommand()) {
      if(i.commandName === 'suspension') { await i.deferReply({flags:D.MessageFlags.Ephemeral}); return await i.editReply(v2('Suspension',await endSuspension(i,i.options.getUser('member',true).id),[],true)); }
      if (i.commandName === 'shift') return await handleShift(i, i.options.getSubcommand());
      if (i.commandName === 'config') return await config(i);
      if (!['infraction','promotion'].includes(i.commandName)) return;
      await admin(i);
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      const data = { kind: i.commandName, userId: i.options.getUser('member',true).id };
      if(data.kind === 'infraction') {
        data.type=i.options.getString('action',true); data.notes=i.options.getString('notes',true);
        data.appealable=i.options.getBoolean('appealable',true); data.evidence=i.options.getString('evidence') || '';
        data.notifyMember=i.options.getBoolean('notify-member') ?? true;
      } else {
        data.previous=i.options.getRole('old-rank',true).id;data.next=i.options.getRole('new-role',true).id;
        data.approvedBy=i.options.getUser('approved-by',true).id;data.effectiveDate=i.options.getString('effective-date',true);
      }
      const result=await issue(i,data,i.options.getString('reason',true), data.kind === 'infraction' ? i.options.getString('suspension-end') || '' : '');
      return await i.editReply(v2('Action Recorded',result,[],true));
    }
    if (i.isStringSelectMenu() && i.customId === 'ticket:create') {
      const type = i.values[0]; if (!TICKETS[type]) throw new Error('Repost the ticket panel using /config panel.');
      const modal = new D.ModalBuilder().setCustomId(`ticket-reason:${type}`).setTitle(`${TICKETS[type]} Ticket`).addComponents(textInput('reason','Why do you want to open a ticket?'));
      modal.addComponents(textInput('details','Additional details',false));
      if (type === 'affairs') modal.addComponents(textInput('reported','Who are you reporting?'),textInput('evidence','Evidence or explanation'));
      return await i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId.startsWith('ticket-reason:')) {
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      const type = i.customId.split(':')[1], reason = i.fields.getTextInputValue('reason').trim();
      if (!reason) throw new Error('A reason is required.');
      const extra = (type === 'affairs' ? `User Reported: ${i.fields.getTextInputValue('reported')}\nProof: ${i.fields.getTextInputValue('evidence')}\n` : '') + `Additional Details: ${i.fields.getTextInputValue('details') || 'None'}`;
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
    if (i.isButton() && ['ticket:claim','ticket:escalate'].includes(i.customId)) {
      await i.deferReply({flags:D.MessageFlags.Ephemeral});
      return await i.editReply(v2('Ticket Updated',await ticketAction(i,i.customId.split(':')[1]),[],true));
    }
    if (i.isButton() && i.customId.startsWith('staff:')) return await i.reply(v2('Use the Slash Command','Use `/infraction issue` or `/promotion issue`; launcher panels are no longer used.',[],true));
    if (i.isButton() && i.customId.startsWith('appeal:')) {
      const record=await collection('cases').findOne({_id:i.customId.split(':')[1],guildId:i.guildId});
      if(!record || !record.appealable || record.userId!==i.user.id) throw new Error('Only the recipient of an appealable infraction may submit an appeal.');
      return await i.showModal(new D.ModalBuilder().setCustomId(`appeal-submit:${record._id}`).setTitle('Appeal Infraction').addComponents(textInput('reason','Why should this infraction be appealed?')));
    }
    if(i.isModalSubmit() && i.customId.startsWith('appeal-submit:')) {
      await i.deferReply({flags:D.MessageFlags.Ephemeral});
      const record=await collection('cases').findOne({_id:i.customId.split(':')[1],guildId:i.guildId});
      if(!record || !record.appealable || record.userId!==i.user.id) throw new Error('This appeal is not available to you.');
      const reason=i.fields.getTextInputValue('reason').trim();if(!reason)throw new Error('An appeal reason is required.');
      return await i.editReply(v2('Infraction Appeal',await openTicket(i,'affairs',reason,`Infraction: INF-${record._id}`),[],true));
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
