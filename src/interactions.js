const D = require('discord.js');
const { settings, setSetting, lockInteraction } = require('./database');
const { embed, privateReply, clean, shortId, COLORS } = require('./utilities/ui');
const { requireStaff, requireOwner, requireBotPermission } = require('./utilities/access');
const { audit } = require('./services/audit');

const CONFIG_KEYS = {
  showcase_channel: 'Showcase channel', showcase_review_channel: 'Showcase review channel', request_channel: 'Design request channel',
  ticket_panel_channel: 'Ticket panel channel', ticket_category: 'Ticket category', transcript_channel: 'Transcript channel',
  log_channel: 'General log channel', moderation_log_channel: 'Moderation log channel', staff_role: 'Staff role',
  admin_role: 'Administrator role', designer_role: 'Designer role', support_role: 'Ticket support role'
};

const row = (...components) => new D.ActionRowBuilder().addComponents(...components);
const button = (id, label, style = D.ButtonStyle.Primary) => new D.ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const input = (id, label, style = D.TextInputStyle.Short, required = true) => new D.TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(style === D.TextInputStyle.Paragraph ? 1000 : 200);

function configPage(interaction, page = 0) {
  const cfg = settings(interaction.client.db, interaction.guildId);
  const pages = [
    ['Channels', Object.entries(CONFIG_KEYS).filter(([k]) => k.endsWith('_channel') || k === 'ticket_category')],
    ['Roles', Object.entries(CONFIG_KEYS).filter(([k]) => k.endsWith('_role'))],
    ['Features', [['showcase_approval','Showcase approval'],['commissions_enabled','Commission wording'],['feedback_enabled','Written feedback']]],
  ];
  page = Math.max(0, Math.min(pages.length - 1, Number(page) || 0));
  const [name, entries] = pages[page];
  const description = entries.map(([key, label]) => `**${label}:** ${cfg[key] ? (key.endsWith('_role') ? `<@&${cfg[key]}>` : key.endsWith('_channel') || key === 'ticket_category' ? `<#${cfg[key]}>` : cfg[key]) : 'Not configured'}`).join('\n');
  const saved = cfg.config_saved_at ? `<t:${Math.floor(Number(cfg.config_saved_at)/1000)}:R>` : '**Not saved yet**';
  const components = [];
  if (page === 0) components.push(row(new D.StringSelectMenuBuilder().setCustomId('config:choose-channel').setPlaceholder('Choose a channel setting').addOptions(entries.map(([value,label]) => ({ label, value })))));
  if (page === 1) components.push(row(new D.StringSelectMenuBuilder().setCustomId('config:choose-role').setPlaceholder('Choose a role setting').addOptions(entries.map(([value,label]) => ({ label, value })))));
  if (page === 2) components.push(row(new D.StringSelectMenuBuilder().setCustomId('config:toggle').setPlaceholder('Toggle a feature').addOptions(entries.map(([value,label]) => ({ label, value })))));
  components.push(row(button(`config:page:${page-1}`,'Previous',D.ButtonStyle.Secondary).setDisabled(page === 0),button(`config:page:${page+1}`,'Next',D.ButtonStyle.Secondary).setDisabled(page === pages.length - 1),button('config:save','Save Changes',D.ButtonStyle.Success)));
  return { embeds:[embed(`Configuration • ${name}`, `${description}\n\n**Last Saved:** ${saved}\nPage ${page+1}/${pages.length}`)], components, flags:D.MessageFlags.Ephemeral, allowedMentions:{parse:[]} };
}

async function handleConfig(i) {
  await requireOwner(i);
  if (i.isChatInputCommand()) { await i.deferReply({ flags:D.MessageFlags.Ephemeral }); return i.editReply(configPage(i)); }
  const [,,value] = i.customId.split(':');
  if (i.customId.startsWith('config:page:')) { await i.deferUpdate(); return i.editReply(configPage(i,value)); }
  if (i.customId === 'config:save') { const savedAt=Date.now();setSetting(i.client.db,i.guildId,'config_saved_at',String(savedAt));await i.deferUpdate();await audit(i.client,i.guild,'configuration',i.user.id,null,'Saved complete configuration',null,String(savedAt));const payload=configPage(i);payload.embeds[0].setFooter({text:'All configuration changes were saved successfully.'});return i.editReply(payload); }
  if (i.customId === 'config:choose-channel') return i.update({ embeds:[embed('Select Channel',`Choose the channel for **${CONFIG_KEYS[i.values[0]]}**.`)], components:[row(new D.ChannelSelectMenuBuilder().setCustomId(`config:set-channel:${i.values[0]}`).setPlaceholder('Select a channel').addChannelTypes(D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement,D.ChannelType.GuildCategory))] });
  if (i.customId.startsWith('config:set-channel:')) { const key=i.customId.split(':')[2]; setSetting(i.client.db,i.guildId,key,i.values[0]); await i.deferUpdate(); await audit(i.client,i.guild,'configuration',i.user.id,null,`Set ${key}`,i.values[0]); return i.editReply(configPage(i)); }
  if (i.customId === 'config:choose-role') return i.update({ embeds:[embed('Select Role',`Choose the role for **${CONFIG_KEYS[i.values[0]]}**.`)], components:[row(new D.RoleSelectMenuBuilder().setCustomId(`config:set-role:${i.values[0]}`).setPlaceholder('Select a role'))] });
  if (i.customId.startsWith('config:set-role:')) { const key=i.customId.split(':')[2], role=await i.guild.roles.fetch(i.values[0]); if(!role||role.id===i.guildId||role.managed)throw new Error('Choose an ordinary server role.'); setSetting(i.client.db,i.guildId,key,role.id); await i.deferUpdate(); await audit(i.client,i.guild,'configuration',i.user.id,role.id,`Set ${key}`); return i.editReply(configPage(i,1)); }
  if (i.customId === 'config:toggle') { const key=i.values[0], cfg=settings(i.client.db,i.guildId), next=cfg[key]==='true'?'false':'true'; setSetting(i.client.db,i.guildId,key,next); await i.deferUpdate(); return i.editReply(configPage(i,2)); }
}

function showcaseEmbed(item) {
  return embed(`${item.featured ? '⭐ ' : ''}${item.title}`,`${item.description}\n\n**Category:** ${item.category}\n**Designer:** <@${item.user_id}>\n**Submission ID:** \`${item.id}\`\n**Status:** ${item.status}`).setImage(item.image_url);
}

async function handleShowcase(i) {
  const db=i.client.db, sub=i.options.getSubcommand(), now=Date.now();
  if(sub==='submit'){
    const image=i.options.getAttachment('image',true);if(!image.contentType?.startsWith('image/'))throw new Error('Upload a PNG, JPEG, WEBP, or GIF image.');if(image.size>8*1024*1024)throw new Error('The image must be 8 MB or smaller.');
    const id=shortId('DSN'),cfg=settings(db,i.guildId),status=cfg.showcase_approval==='false'?'approved':'pending';
    db.prepare('INSERT INTO showcases(id,guild_id,user_id,title,description,category,image_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,i.guildId,i.user.id,clean(i.options.getString('title'),100),clean(i.options.getString('description'),1000),i.options.getString('category'),image.url,status,now,now);
    const destinationId=status==='approved'?cfg.showcase_channel:cfg.showcase_review_channel;
    if(!destinationId)throw new Error(`Configure the ${status==='approved'?'showcase':'showcase review'} channel with /config first.`);
    const channel=await i.guild.channels.fetch(destinationId);if(!channel?.isTextBased())throw new Error('The configured showcase channel is unavailable.');
    const item=db.prepare('SELECT * FROM showcases WHERE id=?').get(id),controls=status==='pending'?[row(button(`showcase:approve:${id}`,'Approve',D.ButtonStyle.Success),button(`showcase:deny:${id}`,'Deny',D.ButtonStyle.Danger))]:[row(button(`showcase:feedback:${id}`,'Give Feedback'))];
    const message=await channel.send({embeds:[showcaseEmbed(item)],components:controls,allowedMentions:{parse:[]}});db.prepare('UPDATE showcases SET channel_id=?,message_id=? WHERE id=?').run(channel.id,message.id,id);await audit(i.client,i.guild,'showcase',i.user.id,null,'Submitted design',null,id);return i.reply(privateReply('Design Submitted',`Your submission ID is \`${id}\`. Status: **${status}**.`,COLORS.success));
  }
  if(sub==='mine'){const rows=db.prepare('SELECT * FROM showcases WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 10').all(i.guildId,i.user.id);return i.reply(privateReply('Your Submissions',rows.length?rows.map(x=>`\`${x.id}\` • **${x.title}** • ${x.status}`).join('\n'):'You have no submissions.'));}
  const id=i.options.getString('id',true).toUpperCase(),item=db.prepare('SELECT * FROM showcases WHERE id=? AND guild_id=?').get(id,i.guildId);if(!item)throw new Error('That showcase submission was not found.');
  if(sub==='view')return i.reply({embeds:[showcaseEmbed(item)],allowedMentions:{parse:[]}});
  await requireStaff(i);if(sub==='feature')db.prepare('UPDATE showcases SET featured=1,updated_at=? WHERE id=?').run(now,id);if(sub==='remove')db.prepare("UPDATE showcases SET status='removed',updated_at=? WHERE id=?").run(now,id);if(sub==='restore')db.prepare("UPDATE showcases SET status='approved',updated_at=? WHERE id=?").run(now,id);await audit(i.client,i.guild,'showcase',i.user.id,item.user_id,sub,i.options.getString('reason'),id);return i.reply(privateReply('Showcase Updated',`Submission \`${id}\` was updated.`,COLORS.success));
}

async function handlePortfolio(i){const db=i.client.db,sub=i.options.getSubcommand(),now=Date.now();if(sub==='create'){db.prepare(`INSERT INTO portfolios(guild_id,user_id,title,bio,specialties,software,links,availability,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'available',?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET title=excluded.title,bio=excluded.bio,specialties=excluded.specialties,software=excluded.software,links=excluded.links,updated_at=excluded.updated_at`).run(i.guildId,i.user.id,clean(i.options.getString('title'),100),clean(i.options.getString('bio'),1000),clean(i.options.getString('specialties'),500),clean(i.options.getString('software'),500),clean(i.options.getString('links')||'None',1000),now,now);return i.reply(privateReply('Portfolio Saved','Your portfolio is ready.',COLORS.success));}if(sub==='visibility'){db.prepare('UPDATE portfolios SET visible=?,updated_at=? WHERE guild_id=? AND user_id=?').run(i.options.getBoolean('visible')?1:0,now,i.guildId,i.user.id);return i.reply(privateReply('Portfolio Updated','Visibility was updated.',COLORS.success));}const user=i.options.getUser('member')||i.user,p=db.prepare('SELECT * FROM portfolios WHERE guild_id=? AND user_id=?').get(i.guildId,user.id);if(!p||(!p.visible&&user.id!==i.user.id))throw new Error('That member does not have a public portfolio.');return i.reply({embeds:[embed(p.title,`${p.bio}\n\n**Designer:** <@${user.id}>\n**Specialties:** ${p.specialties}\n**Software:** ${p.software}\n**Availability:** ${p.availability}\n**Links:** ${p.links}`)],allowedMentions:{parse:[]}});}

async function handleRequest(i){const sub=i.options.getSubcommand(),db=i.client.db;if(sub==='create')return i.showModal(new D.ModalBuilder().setCustomId('request:create').setTitle('Create Design Request').addComponents(row(input('type','Type of design')),row(input('description','Describe what you need',D.TextInputStyle.Paragraph)),row(input('colors','Preferred colors',D.TextInputStyle.Short,false)),row(input('size','Size or platform',D.TextInputStyle.Short,false)),row(input('deadline','Deadline',D.TextInputStyle.Short,false))));if(sub==='mine'){const rows=db.prepare('SELECT * FROM design_requests WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 10').all(i.guildId,i.user.id);return i.reply(privateReply('Your Design Requests',rows.length?rows.map(x=>`\`${x.id}\` • ${x.type} • ${x.status}`).join('\n'):'You have no requests.'));}const id=i.options.getString('id',true).toUpperCase(),request=db.prepare('SELECT * FROM design_requests WHERE id=? AND guild_id=?').get(id,i.guildId);if(!request)throw new Error('That request was not found.');if(sub==='view')return i.reply({embeds:[embed(`Design Request ${id}`,`**Requester:** <@${request.user_id}>\n**Type:** ${request.type}\n**Description:** ${request.description}\n**Colors:** ${request.colors||'Not supplied'}\n**Size/Platform:** ${request.size_platform||'Not supplied'}\n**Deadline:** ${request.deadline||'Not supplied'}\n**Status:** ${request.status}\n**Designer:** ${request.claimed_by?`<@${request.claimed_by}>`:'Unclaimed'}`)],allowedMentions:{parse:[]}});await requireStaff(i,['designer_role','staff_role','admin_role']);let status=sub==='claim'?'claimed':sub==='close'?'closed':sub==='reopen'?'under-review':i.options.getString('status');const previous=request.status,claimed=sub==='claim'?i.user.id:request.claimed_by;db.prepare('UPDATE design_requests SET status=?,claimed_by=?,updated_at=? WHERE id=?').run(status,claimed,Date.now(),id);db.prepare('INSERT INTO request_history(request_id,actor_id,previous_status,new_status,reason,created_at) VALUES(?,?,?,?,?,?)').run(id,i.user.id,previous,status,i.options.getString('reason')||null,Date.now());await audit(i.client,i.guild,'request',i.user.id,request.user_id,`Status: ${status}`,i.options.getString('reason'),id);return i.reply(privateReply('Request Updated',`Request \`${id}\` is now **${status}**.`,COLORS.success));}

async function handleRequestModal(i){const db=i.client.db,cfg=settings(db,i.guildId),channelId=cfg.request_channel;if(!channelId)throw new Error('The design request channel has not been configured.');const id=shortId('REQ'),now=Date.now(),values={type:clean(i.fields.getTextInputValue('type'),200),description:clean(i.fields.getTextInputValue('description'),1000),colors:clean(i.fields.getTextInputValue('colors'),200),size:clean(i.fields.getTextInputValue('size'),200),deadline:clean(i.fields.getTextInputValue('deadline'),200)};db.prepare('INSERT INTO design_requests(id,guild_id,user_id,type,description,colors,size_platform,deadline,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,\'submitted\',?,?)').run(id,i.guildId,i.user.id,values.type,values.description,values.colors,values.size,values.deadline,now,now);const channel=await i.guild.channels.fetch(channelId);const message=await channel.send({embeds:[embed(`Design Request ${id}`,`**Requester:** <@${i.user.id}>\n**Type:** ${values.type}\n**Description:** ${values.description}\n**Colors:** ${values.colors||'Not supplied'}\n**Size/Platform:** ${values.size||'Not supplied'}\n**Deadline:** ${values.deadline||'Not supplied'}\n**Status:** submitted`)],components:[row(button(`request:claim:${id}`,'Claim',D.ButtonStyle.Success),button(`request:close:${id}`,'Close',D.ButtonStyle.Danger))],allowedMentions:{parse:[]}});db.prepare('UPDATE design_requests SET channel_id=?,message_id=? WHERE id=?').run(channel.id,message.id,id);return i.reply(privateReply('Request Submitted',`Your request ID is \`${id}\`.`,COLORS.success));}

module.exports={handleConfig,handleShowcase,handlePortfolio,handleRequest,handleRequestModal,configPage,row,button,input};
