const D=require('discord.js');
const {collection,locked}=require('./store');
const {settings,destination}=require('./discipline');
const {v2,button,row}=require('./panels');
function input(id,label,style=D.TextInputStyle.Paragraph,max=1000){return row(new D.TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(true).setMaxLength(max));}
function requestButton(kind,label){return button(`${kind}:open`,label,D.ButtonStyle.Primary);}
function requestPanel(kind){
 const fast=kind==='fastpass';
 return v2(fast?'Fast Pass Request':'Department Application',fast?'Press **Start Request** and complete every question. Once submitted, staff will be notified and can approve or deny the request. An approver chooses the role only after approval.':'Press **Start Application** to complete the Clearwater Fire & Rescue application. Answer every question honestly and with enough detail for staff to review.',[requestButton(kind,fast?'Start Request':'Start Application')],false,fast?'assistance':'employee');
}
async function openForm(i,kind){
 if(kind==='fastpass')await require('./tickets').ticketAccess(i);
 const modal=new D.ModalBuilder().setCustomId(`${kind}:submit`).setTitle(kind==='fastpass'?'Fast Pass Request':'CWFR Application');
 if(kind==='fastpass')modal.addComponents(input('request','What Fast Pass are you requesting?'),input('reason','Why should this request be approved?'));
 else modal.addComponents(input('experience','Describe your relevant experience'),input('interest','Why do you want to join CWFR?'),input('strengths','What strengths would you bring?'),input('availability','Describe your availability',D.TextInputStyle.Short,200));
 return i.showModal(modal);
}
async function submit(i,kind){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const config=await settings(i.guildId),id=i.id;
 const values={};for(const key of kind==='fastpass'?['request','reason']:['experience','interest','strengths','availability'])values[key]=i.fields.getTextInputValue(key).trim();
 const record={_id:id,guildId:i.guildId,userId:i.user.id,channelId:i.channelId,kind,values,status:'pending',created:Date.now()};
 await collection('requests').insertOne(record);
 const channel=kind==='fastpass'?(config.fastpassLogs?await i.guild.channels.fetch(config.fastpassLogs):i.channel):await destination(i.guild,'applicationResults');
 const details=Object.entries(values).map(([key,value])=>`**${key[0].toUpperCase()+key.slice(1)}:** ${D.escapeMarkdown(value)}`).join('\n\n');
 const controls=[button(`${kind}:approve:${id}`,'Approve',D.ButtonStyle.Success),button(`${kind}:deny:${id}`,'Deny',D.ButtonStyle.Danger)];
 await channel.send({...v2(kind==='fastpass'?'Fast Pass Review':'Application Review',`**Applicant:** <@${i.user.id}>\n**Submitted in:** <#${i.channelId}>\n\n${details}`,controls),allowedMentions:{parse:[]}});
 const staff=config.role_staff||config.role_management||config.role_hr;
 if(staff)await channel.send({content:`<@&${staff}> new ${kind==='fastpass'?'Fast Pass request':'application'} ready for review.`,allowedMentions:{parse:[],roles:[staff]}});
 return i.editReply(v2('Request Submitted','Your answers were saved and the review team was notified.',[],true));
}
async function decision(i,kind,action,id){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 await require('./access').requireAccess(i,kind==='application'?'hr':'management');
 const record=await collection('requests').findOne({_id:id,guildId:i.guildId,kind});
 if(!record||record.status!=='pending')throw new Error('This request has already been handled or no longer exists.');
 if(action==='deny'){
  await collection('requests').updateOne({_id:id,status:'pending'},{$set:{status:'denied',reviewer:i.user.id,reviewed:Date.now()}});
  await i.message.edit(v2(kind==='fastpass'?'Fast Pass Denied':'Application Denied',`**Applicant:** <@${record.userId}>\n**Denied by:** <@${i.user.id}>`));
  return i.editReply(v2('Request Denied','The decision was saved.',[],true));
 }
 const select=new D.RoleSelectMenuBuilder().setCustomId(`${kind}:role:${id}`).setPlaceholder('Choose the role to grant').setMinValues(1).setMaxValues(1);
 return i.editReply(v2('Choose Approval Role','Select the exact role this applicant should receive.',[select],true));
}
async function grant(i,kind,id){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 await require('./access').requireAccess(i,kind==='application'?'hr':'management');
 return locked(`request:${id}`,async()=>{
  const record=await collection('requests').findOne({_id:id,guildId:i.guildId,kind});if(!record||record.status!=='pending')throw new Error('This request has already been handled.');
  const role=await i.guild.roles.fetch(i.values[0]),member=await i.guild.members.fetch({user:record.userId,force:true}),me=await i.guild.members.fetchMe();
  if(!role||role.managed||role.id===i.guildId||role.position>=me.roles.highest.position)throw new Error('Choose a normal role below the bot’s highest role.');
  await member.roles.add(role,`${kind} approved by ${i.user.id}`);
  await collection('requests').updateOne({_id:id,status:'pending'},{$set:{status:'approved',reviewer:i.user.id,reviewed:Date.now(),roleId:role.id}});
  await require('./logging').record('roles',i.guildId,kind==='fastpass'?'Fast Pass Approved':'Application Approved',`**Member:** <@${member.id}>\n**Role:** <@&${role.id}>\n**Approved by:** <@${i.user.id}>`,`request:${id}`).catch(()=>{});
  return i.editReply(v2('Request Approved',`<@${member.id}> received <@&${role.id}>. The approval was logged.`,[],true));
 });
}
async function startActivity(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const config=await settings(i.guildId),member=await i.guild.members.fetch({user:i.user.id,force:true});
 if(!member.permissions.has(D.PermissionFlagsBits.Administrator)&&!(config.role_high_command&&member.roles.cache.has(config.role_high_command)))throw new Error('Only High Command can start an activity check.');
 const channel=await destination(i.guild,'activityChecks'),id=i.id;
 await collection('activity_checks').insertOne({_id:id,guildId:i.guildId,startedBy:i.user.id,created:Date.now(),members:[],status:'open'});
 await channel.send({...v2('Department Activity Check','All available members should press **I’m Active** below. High Command can end the check at any time.',[button(`activity:join:${id}`,"I'm Active",D.ButtonStyle.Success),button(`activity:end:${id}`,'End Check',D.ButtonStyle.Danger)]),allowedMentions:{parse:['everyone']},content:'@everyone'});
 return i.editReply(v2('Activity Check Started',`The activity check was posted in <#${channel.id}>.`,[],true));
}
async function activityButton(i,action,id){
 if(action==='join'){
  const result=await collection('activity_checks').updateOne({_id:id,status:'open'},{$addToSet:{members:i.user.id}});if(!result.matchedCount)throw new Error('This activity check has ended.');
  return i.reply(v2('Activity Recorded','You have been marked active.',[],true));
 }
 await i.deferReply({flags:D.MessageFlags.Ephemeral});await require('./access').requireAccess(i,'high_command');
 const record=await collection('activity_checks').findOne({_id:id,status:'open'});if(!record)throw new Error('This activity check has already ended.');
 await collection('activity_checks').updateOne({_id:id,status:'open'},{$set:{status:'closed',ended:Date.now(),endedBy:i.user.id}});
 const list=record.members.length?record.members.map(x=>`<@${x}>`).join(', '):'No members responded.';
 await i.message.edit(v2('Activity Check Complete',`**Responses:** ${record.members.length}\n${list}`));
 return i.editReply(v2('Activity Check Ended',`${record.members.length} member(s) responded.`,[],true));
}
function supervisorPanel(){return v2('Supervisor Guide',['### Leadership Standard\nSupervisors set the example, remain professional, communicate clearly, and apply department policy consistently.','### Shift Oversight\nConfirm staffing, assign units fairly, monitor conduct, document important events, and address problems calmly through the proper chain of command.','### Discipline & Tickets\nUse evidence, keep private information inside authorized channels, record actions accurately, and never promise an outcome before review.','### Escalation\nEscalate serious or uncertain matters to High Command. Preserve relevant screenshots, message links, user IDs, and case references.'],[],false,'employee');}
async function tripwire(message){
 let config;try{config=await settings(message.guild.id);}catch{return false;}if(message.channelId!==config.tripwire||message.author.bot)return false;
 const member=await message.guild.members.fetch({user:message.author.id,force:true});
 if(member.id===message.guild.ownerId||member.permissions.has(D.PermissionFlagsBits.Administrator))return false;
 const me=await message.guild.members.fetchMe();if(!me.permissions.has(D.PermissionFlagsBits.BanMembers))throw new Error('The bot needs Ban Members for the configured tripwire channel.');
 await member.ban({deleteMessageSeconds:60,reason:`Tripwire channel message ${message.id}`});
 await message.guild.members.unban(member.id,'Tripwire soft-ban completed');
 await require('./logging').record('moderation',message.guild.id,'Tripwire Soft-Ban',`**Member:** <@${member.id}>\n**Channel:** <#${message.channelId}>`,`tripwire:${message.id}`).catch(()=>{});
 return true;
}
module.exports={requestPanel,openForm,submit,decision,grant,startActivity,activityButton,supervisorPanel,tripwire};
