const D=require('discord.js');
const {collection}=require('./store');
const {CHANNELS,TICKETS}=require('./settings');
const {settings}=require('./discipline');
const {v2,button}=require('./panels');
const ACCESS_ID='1262469782897295461';
const ROLE_PURPOSES=['staff','management','infraction','promotion','deployment_ping','hr','say','high_command','on_duty','on_break'];
const PANELS=['ticket','shift','information','employee','cadet','oia','application','supervisor'];
const CHANNEL_KEYS=Object.keys(CHANNELS);
async function authorized(i){
 const member=await i.guild.members.fetch({user:i.user.id,force:true});
 if(i.user.id!==ACCESS_ID&&!member.roles.cache.has(ACCESS_ID))throw new Error(`Only <@${ACCESS_ID}> or members with <@&${ACCESS_ID}> can use the configuration dashboard.`);
 return member;
}
function select(id,placeholder,values){return new D.StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(values.map(value=>({label:value.replaceAll('_',' ').slice(0,100),value})))}
function channelSelect(id){return new D.ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder('Choose the destination channel').addChannelTypes(D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement,D.ChannelType.GuildCategory);}
function roleSelect(id){return new D.RoleSelectMenuBuilder().setCustomId(id).setPlaceholder('Choose the server role');}
function nav(page,total){return [button(`config:page:${Math.max(0,page-1)}`,'Previous',D.ButtonStyle.Secondary).setDisabled(page===0),button(`config:page:${Math.min(total-1,page+1)}`,'Next',D.ButtonStyle.Secondary).setDisabled(page===total-1)];}
async function page(i,page=0,notice=''){
 await authorized(i);const config=await settings(i.guildId),channelGroups=[];for(let n=0;n<CHANNEL_KEYS.length;n+=20)channelGroups.push(CHANNEL_KEYS.slice(n,n+20));
 const total=channelGroups.length+3;page=Math.max(0,Math.min(total-1,Number(page)||0));let title,body,controls=[];
 if(page<channelGroups.length){const keys=channelGroups[page];title='Configuration • Channels';body=keys.map(k=>`**${k.replaceAll('_',' ')}:** ${config[k]?`<#${config[k]}>`:'Not configured'}`).join('\n');controls.push(select('config:choose-channel','Choose a setting to edit',keys));}
 else if(page===channelGroups.length){title='Configuration • Roles';body=ROLE_PURPOSES.map(k=>`**${k.replaceAll('_',' ')}:** ${config['role_'+k]?`<@&${config['role_'+k]}>`:'Not configured'}`).join('\n');controls.push(select('config:choose-role','Choose a role setting to edit',ROLE_PURPOSES));}
 else if(page===channelGroups.length+1){title='Configuration • Ticket Access';body=Object.entries(TICKETS).map(([k,name])=>`**${name}:** ${config['support_'+k]?`<@&${config['support_'+k]}>`:'Not configured'}`).join('\n');controls.push(select('config:choose-support','Choose a ticket department',Object.keys(TICKETS)));}
 else{title='Configuration • Panels';body='Post panels, replace their wording, or upload a new banner by dragging an image into Discord. Saved changes are used the next time that panel is posted.';controls.push(select('config:choose-panel','Post a panel',PANELS),select('config:edit-text','Edit panel wording',PANELS),select('config:upload-banner','Upload a panel banner',PANELS));}
 if(notice)body=`${notice}\n\n${body}`;controls.push(...nav(page,total));
 return v2(title,`${body}\n\n-# Page ${page+1} of ${total}`,controls,true);
}
async function open(i){await i.deferReply({flags:D.MessageFlags.Ephemeral});return i.editReply(await page(i,0));}
async function handle(i){
 await authorized(i);const parts=i.customId.split(':'),action=parts[1];
 if(action==='page'){await i.deferUpdate();return i.editReply(await page(i,parts[2]));}
 if(action==='choose-channel')return i.update(v2('Set Channel Destination',`You selected **${i.values[0].replaceAll('_',' ')}**. Choose its channel below.`,[channelSelect(`config:set-channel:${i.values[0]}`)],true));
 if(action==='set-channel'){
  const key=parts.slice(2).join(':'),channel=await i.guild.channels.fetch(i.values[0]);if(!Object.hasOwn(CHANNELS,key))throw new Error('That configuration destination is invalid.');
  const ticket=key==='tickets'||key.startsWith('tickets_');if(ticket? ![D.ChannelType.GuildCategory,D.ChannelType.GuildText].includes(channel.type):![D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement].includes(channel.type))throw new Error(ticket?'Ticket destinations require a category or text channel.':'Choose a text or announcement channel.');
  await collection('config').updateOne({_id:i.guildId},{$set:{[key]:channel.id}},{upsert:true});await i.deferUpdate();return i.editReply(await page(i,0,`✅ **${key.replaceAll('_',' ')}** now points to <#${channel.id}>.`));
 }
 if(action==='choose-role')return i.update(v2('Set Staff Role',`Choose the role for **${i.values[0].replaceAll('_',' ')}**.`,[roleSelect(`config:set-role:${i.values[0]}`)],true));
 if(action==='set-role'){
  const purpose=parts[2],role=await i.guild.roles.fetch(i.values[0]);if(!ROLE_PURPOSES.includes(purpose)||!role||role.id===i.guildId||role.managed)throw new Error('Choose an ordinary server role.');
  await collection('config').updateOne({_id:i.guildId},{$set:{['role_'+purpose]:role.id}},{upsert:true});await i.deferUpdate();return i.editReply(await page(i,Math.ceil(CHANNEL_KEYS.length/20),`✅ **${purpose.replaceAll('_',' ')}** now uses <@&${role.id}>.`));
 }
 if(action==='choose-support')return i.update(v2('Set Ticket Access',`Choose the support role for **${TICKETS[i.values[0]]}** tickets.`,[roleSelect(`config:set-support:${i.values[0]}`)],true));
 if(action==='set-support'){
  const type=parts[2],role=await i.guild.roles.fetch(i.values[0]);if(!TICKETS[type]||!role||role.id===i.guildId||role.managed)throw new Error('Choose an ordinary support role.');
  await collection('config').updateOne({_id:i.guildId},{$set:{['support_'+type]:role.id}},{upsert:true});await i.deferUpdate();return i.editReply(await page(i,Math.ceil(CHANNEL_KEYS.length/20)+1,`✅ **${TICKETS[type]}** tickets now use <@&${role.id}>.`));
 }
 if(action==='choose-panel')return i.update(v2('Post Configuration Panel',`Choose the text channel where the **${i.values[0]}** panel should be posted.`,[channelSelect(`config:post-panel:${i.values[0]}`)],true));
 if(action==='edit-text'){
  const type=i.values[0],config=await settings(i.guildId),input=new D.TextInputBuilder().setCustomId('content').setLabel('Panel wording').setStyle(D.TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
  if(config['panel_text_'+type])input.setValue(config['panel_text_'+type].slice(0,4000));
  return i.showModal(new D.ModalBuilder().setCustomId(`config:save-text:${type}`).setTitle(`Edit ${type} panel`.slice(0,45)).addComponents(new D.ActionRowBuilder().addComponents(input)));
 }
 if(action==='save-text'){
  const type=parts[2],content=i.fields.getTextInputValue('content').trim();if(!PANELS.includes(type)||!content)throw new Error('Enter panel wording before saving.');
  await collection('config').updateOne({_id:i.guildId},{$set:{['panel_text_'+type]:content}},{upsert:true});return i.reply(v2('Panel Wording Saved',`The **${type}** panel will use the new wording the next time it is posted.`,[],true));
 }
 if(action==='upload-banner'){
  const type=i.values[0];await collection('config_uploads').updateOne({_id:`${i.guildId}:${i.user.id}`},{$set:{guildId:i.guildId,userId:i.user.id,channelId:i.channelId,type,expires:Date.now()+300000}},{upsert:true});
  return i.update(v2('Upload Panel Banner',`Drag and send one **PNG, JPEG, WEBP, or GIF** image into this channel within five minutes. The bot will attach it to the **${type}** panel.\n\nRecommended size: **1536 × 240**.`,[],true));
 }
 if(action==='post-panel'){
  const type=parts[2],channel=await i.guild.channels.fetch(i.values[0]);if(!PANELS.includes(type)||![D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement].includes(channel.type))throw new Error('Choose a text or announcement channel.');
  const payload=await panelPayload(type,i.guild,i.guildId);
  await require('./config-delivery').sendPanel(channel,i.guild,payload);await i.deferUpdate();return i.editReply(await page(i,Math.ceil(CHANNEL_KEYS.length/20)+2,`✅ The **${type}** panel was posted in <#${channel.id}>.`));
 }
}
async function panelPayload(type,guild,guildId){
 const workflows=require('./workflows'),payload=type==='shift'?require('./shifts').shiftPanel():type==='ticket'?require('./panels').panel(type):type==='application'?workflows.requestPanel('application'):type==='supervisor'?workflows.supervisorPanel():require('./department-panels').get(type,guild);
 const config=await settings(guildId),text=config['panel_text_'+type],banner=config['panel_banner_'+type];if(!text&&!banner)return payload;
 const old=payload.components[0],parts=old.components,title=parts.find(c=>c.toJSON().type===D.ComponentType.TextDisplay),rows=parts.filter(c=>c.toJSON().type===D.ComponentType.ActionRow),galleries=parts.filter(c=>c.toJSON().type===D.ComponentType.MediaGallery),box=new D.ContainerBuilder().setAccentColor(old.data.accent_color||0x5685EF);
 if(banner)box.addMediaGalleryComponents(new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(banner)));else if(galleries[0])box.addMediaGalleryComponents(galleries[0]);
 if(title)box.addTextDisplayComponents(title);box.addSeparatorComponents(new D.SeparatorBuilder());box.addTextDisplayComponents(new D.TextDisplayBuilder().setContent(text||'Panel content configured by Clearwater Fire & Rescue.'));for(const row of rows)box.addActionRowComponents(row);if(galleries.length>1)box.addMediaGalleryComponents(galleries.at(-1));
 return {...payload,components:[box]};
}
async function handleUpload(message){
 let pending;try{pending=await collection('config_uploads').findOne({_id:`${message.guild.id}:${message.author.id}`,channelId:message.channelId,expires:{$gt:Date.now()}});}catch{return false;}if(!pending)return false;
 const member=await message.guild.members.fetch({user:message.author.id,force:true});if(message.author.id!==ACCESS_ID&&!member.roles.cache.has(ACCESS_ID))return false;
 const image=message.attachments.find(a=>a.contentType?.startsWith('image/'));if(!image)throw new Error('Send one image attachment to complete the banner upload.');if(image.size>8*1024*1024)throw new Error('The banner image must be 8 MB or smaller.');
 await collection('config').updateOne({_id:message.guild.id},{$set:{['panel_banner_'+pending.type]:image.url}},{upsert:true});await collection('config_uploads').deleteOne({_id:pending._id});
 await message.reply({...v2('Banner Saved',`The **${pending.type}** panel will use this banner the next time it is posted.`),allowedMentions:{parse:[],repliedUser:false}});return true;
}
module.exports={ACCESS_ID,ROLE_PURPOSES,PANELS,authorized,page,open,handle,panelPayload,handleUpload};
