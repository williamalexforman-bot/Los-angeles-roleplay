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
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  await admin(i);
  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const s = await settings(i.guildId);
    return i.editReply(v2('Configured Destinations', Object.keys(CHANNELS).map(k => `**${k}:** ${s[k] ? `<#${s[k]}>` : 'Not configured'}`).join('\n'), [], true));
  }
  if (sub === 'channel') {
    const key = i.options.getString('destination', true), channel = i.options.getChannel('channel', true);
    if (!Object.hasOwn(CHANNELS,key)) throw new Error('Choose a valid destination.');
    if (key === 'tickets' || key.startsWith('tickets_') ? ![D.ChannelType.GuildCategory,D.ChannelType.GuildText].includes(channel.type) : ![D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Ticket destinations require a category or text channel; other destinations require a text channel.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { [key]: channel.id } }, { upsert: true });
    return i.editReply(v2('Destination Updated', `**${key}** now points to <#${channel.id}>.`, [], true));
  }
  if(sub==='staff-role') {
    const purpose=i.options.getString('purpose',true), role=i.options.getRole('role',true);
    if(role.id===i.guildId || role.managed)throw new Error('Choose an ordinary staff role.');
    await collection('config').updateOne({_id:i.guildId},{$set:{['role_'+purpose]:role.id}},{upsert:true});
    return i.editReply(v2('Staff Access Updated',`**${purpose}:** <@&${role.id}>`,[],true));
  }

  if (sub === 'ticket-access') {
    const type = i.options.getString('department', true), role = i.options.getRole('role', true);
    if (role.id === i.guildId || role.managed) throw new Error('Choose a staff role, not @everyone or a managed role.');
    await collection('config').updateOne({ _id: i.guildId }, { $set: { [`support_${type}`]: role.id } }, { upsert: true });
    return i.editReply(v2('Ticket Access Updated', `New ${TICKETS[type]} tickets will be visible to <@&${role.id}>. Existing tickets will keep their current access.`, [], true));
  }
  const type = i.options.getString('panel',true);
  if (!['ticket','shift','information','employee','cadet','oia','application','supervisor'].includes(type)) throw new Error('Choose a supported panel.');
  let channel = i.options.getChannel('channel');
  if (!channel) {
    const defaults={ticket:'ticketPanel',information:'information',employee:'employeeInfo',cadet:'cadetInfo',oia:'oiaInfo',application:'applicationPanel',supervisor:'supervisorInfo'};
    if(defaults[type]) channel=await destination(i.guild,defaults[type]);
    else channel=i.channel;
  }
  if(!channel)throw new Error('Choose a channel for this panel using the channel option, or configure its destination first.');
  const workflows=require('./workflows');
  const payload=type==='shift'?require('./shifts').shiftPanel():type==='ticket'?panel(type):type==='application'?workflows.requestPanel('application'):type==='supervisor'?workflows.supervisorPanel():require('./department-panels').get(type,i.guild);
  await require('./config-delivery').sendPanel(channel, i.guild, payload);
  return i.editReply(v2('Panel Successfully Posted', `The selected panel is now available in <#${channel.id}>.`, [], true));
}
async function handleInteraction(i) {
  try {
    if(i.guildId !== require('./settings').GUILD_ID) return;


    if (!i.inGuild()) return;
    if (i.isAutocomplete?.()) {
      if (i.commandName !== 'config' || i.options.getSubcommand() !== 'channel') return;
      const query=String(i.options.getFocused()).toLowerCase();
      return await i.respond(Object.keys(CHANNELS).filter(key=>key.toLowerCase().includes(query)).slice(0,25).map(value=>({name:value,value})));
    }
    if(i.isButton()&&i.customId.startsWith('shift:'))return await require('./shifts').handleShift(i,i.customId.split(':')[1]);
    if(i.isButton()&&/^(fastpass|application):open$/.test(i.customId))return require('./workflows').openForm(i,i.customId.split(':')[0]);
    if(i.isButton()&&/^(fastpass|application):(approve|deny):/.test(i.customId)){const [kind,action,id]=i.customId.split(':');return require('./workflows').decision(i,kind,action,id);}
    if(i.isRoleSelectMenu?.()&&/^(fastpass|application):role:/.test(i.customId)){const [kind,,id]=i.customId.split(':');return require('./workflows').grant(i,kind,id);}
    if(i.isButton()&&i.customId.startsWith('activity:')){const [,action,id]=i.customId.split(':');return require('./workflows').activityButton(i,action,id);}
    if(i.isModalSubmit?.()&&i.customId.startsWith('config:'))return require('./config-dashboard').handle(i);
    if((i.isButton?.()||i.isStringSelectMenu?.()||i.isChannelSelectMenu?.()||i.isRoleSelectMenu?.())&&i.customId?.startsWith('config:'))return require('./config-dashboard').handle(i);
    if(i.isButton()&&i.customId.startsWith('role-request:'))return await require('./role-requests').handle(i);
    if(i.isButton() && ['close-request:accept','close-request:decline'].includes(i.customId))return await require('./utilities').respond(i);

    if (i.isChatInputCommand()) {

      if(['dm','role'].includes(i.commandName))return await require('./owner-tools').slash(i);
      if(i.commandName==='quota')return await require('./quota').quotaCommand(i);
      if(i.commandName==='shift')return await require('./shifts').showControls(i);
      if(i.commandName==='fastpass'){await require('./tickets').ticketAccess(i);return i.reply(require('./workflows').requestPanel('fastpass'));}
      if(i.commandName==='application')return require('./workflows').openForm(i,'application');
      if(i.commandName==='activity-check')return require('./workflows').startActivity(i);
      if(i.commandName==='say')return await require('./messages').handleMessageCommand(i);
      if(i.commandName==='requestrole')return await require('./role-requests').submit(i);
      if(i.commandName==='add-emojis')return await require('./emoji-install').slash(i);
      if(i.commandName === 'cmds') return await require('./command-help').handle(i);

      if(require('./utilities').COMMANDS.includes(i.commandName))return await require('./utilities').slash(i);
      if(i.commandName==='deployment') return await require('./messages').handleMessageCommand(i);
      if(i.commandName === 'suspension') { await i.deferReply({flags:D.MessageFlags.Ephemeral}); return await i.editReply(v2('Suspension',await endSuspension(i,i.options.getUser('member',true).id),[],true)); }


      if (i.commandName === 'config') return require('./config-dashboard').open(i);
      if (!['infraction','promotion'].includes(i.commandName)) return;
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      await require('./access').requireAccess(i,i.commandName);
      if(i.commandName==='infraction'&&['edit','revoke'].includes(i.options.getSubcommand())){
        const action=i.options.getSubcommand(),updates={};
        if(action==='edit'){
          for(const field of ['reason','notes','evidence']){const value=i.options.getString(field);if(value!==null)updates[field]=value;}
          const appealable=i.options.getBoolean('appealable');if(appealable!==null)updates.appealable=appealable;
        }
        const result=await require('./infraction-management').change(i,action,i.options.getString('case-id',true),updates,i.options.getString(action==='edit'?'change-reason':'reason',true));
        return i.editReply(v2('Infraction Updated',result,[],true));
      }
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
    if (i.isStringSelectMenu() && i.customId === 'cpfr:information') {
      if(i.values[0]==='regulations'){
        const payload=require('./department-panels').get('regulations',i.guild);payload.flags|=D.MessageFlags.Ephemeral;return await i.reply(payload);
      }
    }
    if (i.isModalSubmit() && i.customId.startsWith('ticket-reason:')) {
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      const type = i.customId.split(':')[1], reason = i.fields.getTextInputValue('reason').trim();
      if (!reason) throw new Error('A reason is required.');
      const extra = (type === 'affairs' ? `User Reported: ${i.fields.getTextInputValue('reported')}\nProof: ${i.fields.getTextInputValue('evidence')}\n` : '') + `Additional Details: ${i.fields.getTextInputValue('details') || 'None'}`;
      return await i.editReply(v2('Support Ticket Opened', await openTicket(i, type, reason, extra), [], true));
    }
    if(i.isModalSubmit()&&/^(fastpass|application):submit$/.test(i.customId))return require('./workflows').submit(i,i.customId.split(':')[0]);
    if (i.isButton() && i.customId === 'ticket:close') {
      await i.deferReply({ flags: D.MessageFlags.Ephemeral });
      await ticketAccess(i);
      return await i.editReply(v2('Confirm Ticket Closure', 'A transcript will be saved before this ticket channel is removed.', [button('ticket:confirm-close','Save Transcript & Close', D.ButtonStyle.Danger)], true));
    }
    if (i.isButton() && i.customId === 'ticket:confirm-close') {
      await i.deferUpdate();
      await closeTicket(i); return;
    }
    if (i.isButton() && ['ticket:claim','ticket:escalate'].includes(i.customId)) {
      await i.deferReply({flags:D.MessageFlags.Ephemeral});
      return await i.editReply(v2('Ticket Status Updated',await ticketAction(i,i.customId.split(':')[1]),[],true));
    }
    if (i.isButton() && i.customId.startsWith('staff:')) return await i.reply(v2('Use the Slash Command','Use `/infraction issue` or `/promotion issue`; launcher panels are no longer used.',[],true));
    if (i.isButton() && i.customId.startsWith('appeal:')) {
      const record=await collection('cases').findOne({_id:i.customId.split(':')[1],guildId:i.guildId});
      if(!record || record.revoked || !record.appealable || record.userId!==i.user.id) throw new Error('Only the recipient of an appealable infraction may submit an appeal.');
      return await i.showModal(new D.ModalBuilder().setCustomId(`appeal-submit:${record._id}`).setTitle('Appeal Infraction').addComponents(textInput('reason','Why should this infraction be appealed?')));
    }
    if(i.isModalSubmit() && i.customId.startsWith('appeal-submit:')) {
      await i.deferReply({flags:D.MessageFlags.Ephemeral});
      const record=await collection('cases').findOne({_id:i.customId.split(':')[1],guildId:i.guildId});
      if(!record || record.revoked || !record.appealable || record.userId!==i.user.id) throw new Error('This appeal is not available to you.');
      const reason=i.fields.getTextInputValue('reason').trim();if(!reason)throw new Error('An appeal reason is required.');
      const review=await destination(i.guild,'appeals');
      const result=await openTicket(i,'affairs',reason,`Infraction: INF-${record._id}`);
      await review.send({...v2('Infraction Appeal',`**Member:** <@${i.user.id}>\n**Case:** INF-${record._id}\n**Reason:** ${D.escapeMarkdown(reason)}\n\n${result}`),nonce:i.id,enforceNonce:true});
      return await i.editReply(v2('Infraction Appeal',result,[],true));
    }
  } catch(e) {
    if (i.isAutocomplete?.()) { await i.respond([]).catch(()=>{}); return; }
    console.error('Interaction failed:', i.commandName || i.customId, i.commandName==='config'&&i.options.getSubcommand?.(false) ? i.options.getSubcommand(false) : '', i.id, e.code || e.name, 'status:', e.status, 'invalid fields:', require('./config-delivery').errorFields(e));
    const message = require('./config-delivery').describeError(e) + `\n\nReference: ${i.id}`;
    const payload = v2('Unable to Complete Action',message,[],true);
    if (i.deferred || i.replied) await i.editReply(payload).catch(() => {});
    else await i.reply(payload).catch(() => {});
  }
}
module.exports = { handleInteraction, textInput, config };
