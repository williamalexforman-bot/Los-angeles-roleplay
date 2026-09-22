const D=require('discord.js');
const {collection,locked}=require('./store');
const {settings,destination}=require('./discipline');
const {v2,button}=require('./panels');
function hrRole(config){return config.role_hr||config.support_high;}
async function reviewer(guild,userId){
 const member=await guild.members.fetch({user:userId,force:true}),config=await settings(guild.id);
 if(!member.permissions.has(D.PermissionFlagsBits.Administrator)&&!(hrRole(config)&&member.roles.cache.has(hrRole(config))))throw new Error('Only the configured HR role or a server administrator can decide role requests.');
 return member;
}
async function validate(guild,userId,roleId,actor){
 const member=await guild.members.fetch({user:userId,force:true});
 const role=await guild.roles.fetch(roleId),me=await guild.members.fetchMe();
 if(member.user.bot)throw new Error('Choose a human trainee.');
 if(!role||role.id===guild.id||role.managed)throw new Error('Choose an ordinary server role, not @everyone or a managed role.');
 if(!me.permissions.has(D.PermissionFlagsBits.ManageRoles)||me.roles.highest.comparePositionTo(role)<=0)throw new Error('The bot needs Manage Roles and must be above the requested role.');
 if(actor&&!actor.permissions.has(D.PermissionFlagsBits.Administrator)){
  if(actor.roles.highest.comparePositionTo(role)<=0||role.permissions.has([D.PermissionFlagsBits.Administrator],false)||role.permissions.has(D.PermissionFlagsBits.ManageRoles))throw new Error('An administrator must approve this role because of its permissions or position.');
 }
 return {member,role};
}
function panel(record){
 const pending=record.status==='pending';
 const labels={pending:'Awaiting HR review',approving:'Approved — role assignment pending',approved:'Approved — role assigned',denied:'Denied'};
 const body=`**Trainee:** <@${record.trainee}>\n**Requested role:** <@&${record.roleId}>\n**Requested by:** <@${record.requester}>\n**HR:** <@&${record.hrRole}>\n**Status:** ${labels[record.status]}\n${record.decidedBy?`**Reviewed by:** <@${record.decidedBy}>\n`:''}**Submitted:** <t:${Math.floor(record.created/1000)}:F>\n-# Request ID: ${record._id}`;
 return v2('Trainee Role Request',body,[button(`role-request:approve:${record._id}`,'Approve Request',D.ButtonStyle.Success).setDisabled(!pending),button(`role-request:deny:${record._id}`,'Deny Request',D.ButtonStyle.Danger).setDisabled(!pending)]);
}
async function deliver(guild,record){
 const channel=await guild.channels.fetch(record.channelId);
 let message=record.messageId?await channel.messages.fetch(record.messageId).catch(e=>{if(e.code===10008)return null;throw e;}):null;
 if(message)await message.edit({...panel(record),content:null,embeds:[]});
 else{
  const role=await guild.roles.fetch(record.hrRole),me=await guild.members.fetchMe();
  if(record.status==='pending'&&(!role||(!role.mentionable&&!channel.permissionsFor(me)?.has(D.PermissionFlagsBits.MentionEveryone))))throw new Error('Make the HR role mentionable or grant the bot Mention Everyone in the request channel.');
  message=await require('./config-delivery').sendPanel(channel,guild,{...panel(record),nonce:record._id,enforceNonce:true,allowedMentions:{parse:[],roles:record.status==='pending'?[record.hrRole]:[]}});
 }
 await collection('role_requests').updateOne({_id:record._id},{$set:{messageId:message.id,noticePending:false}});return message;
}
async function submit(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const trainee=i.options.getUser('trainee',true).id,roleId=i.options.getRole('role',true).id;
 await validate(i.guild,trainee,roleId);
 const config=await settings(i.guildId),hr=hrRole(config);
 if(!hr)throw new Error('Set the HR role first: /config staff-role purpose:hr role:@HR.');
 const role=await i.guild.roles.fetch(hr);if(!role||role.id===i.guildId)throw new Error('The configured HR role is unavailable.');
 const channel=await destination(i.guild,'roleRequests'),me=await i.guild.members.fetchMe();
 if(!role.mentionable&&!channel.permissionsFor(me)?.has(D.PermissionFlagsBits.MentionEveryone))throw new Error('Make HR mentionable or give the bot Mention Everyone in the request channel.');
 const result=await locked(`role-request:${i.guildId}:${trainee}:${roleId}`,async()=>{
  const previous=await collection('role_requests').findOne({guildId:i.guildId,trainee,roleId,status:{$in:['pending','approving']}});
  if(previous)return 'A request for that trainee and role is already awaiting completion.';
  const record={_id:i.id,guildId:i.guildId,trainee,roleId,hrRole:hr,requester:i.user.id,channelId:channel.id,status:'pending',created:Date.now(),noticePending:true};
  await collection('role_requests').insertOne(record);
  try{const message=await deliver(i.guild,record);return `HR has been notified. [View request](${message.url})`;}
  catch(e){console.error('Role request post pending:',i.id,e.code||e.name);return 'Your request is saved. Posting it to HR is pending and will retry automatically.';}
 });
 await i.editReply(v2('Role Request Submitted',result,[],true));
}
async function finish(guild,record){
 if(record.status==='approving')await locked(`member:${record.guildId}:${record.trainee}`,async()=>{
  const state=await collection('members').findOne({_id:`${record.guildId}:${record.trainee}`});
  if(state?.suspension)throw new Error('Role assignment is paused while the trainee is suspended.');
  if(await require('./infraction-management').pending(record.guildId,record.trainee))throw new Error('A disciplinary role change is pending.');
  if(await collection('cases').findOne({guildId:record.guildId,userId:record.trainee,status:'prepared'}))throw new Error('An earlier disciplinary action is pending.');
  const actor=await reviewer(guild,record.decidedBy);
  if(record.decidedBy===record.trainee)throw new Error('A different HR member must approve the request.');
  const {member}=await validate(guild,record.trainee,record.roleId,actor);
  if(!member.roles.cache.has(record.roleId))await member.roles.add(record.roleId,`Approved by ${record.decidedBy}; request ${record._id}`);
  await collection('role_requests').updateOne({_id:record._id},{$set:{status:'approved',noticePending:true}});record.status='approved';
 });
 await deliver(guild,record);
 if(record.status!=='pending')await require('./logging').record('roles',guild.id,'Role Request '+record.status,`**Trainee:** <@${record.trainee}>\n**Role:** <@&${record.roleId}>\n**Reviewer:** <@${record.decidedBy}>`,`${record._id}:${record.status}`);
}
async function handle(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const [,action,id]=i.customId.split(':');if(!['approve','deny'].includes(action))throw new Error('Invalid request action.');
 const actor=await reviewer(i.guild,i.user.id);
 const result=await locked(`role-decision:${id}`,async()=>{
  const record=await collection('role_requests').findOne({_id:id,guildId:i.guildId});
  if(!record||record.channelId!==i.channelId||record.messageId!==i.message.id)throw new Error('This role request is unavailable.');
  if(record.status!=='pending')return 'This request has already been decided. Any pending role assignment will retry automatically.';
  if(action==='approve'){
   if(record.trainee===i.user.id)throw new Error('A different HR member must approve your role request.');
   await validate(i.guild,record.trainee,record.roleId,actor);
  }
  Object.assign(record,{status:action==='approve'?'approving':'denied',decidedBy:i.user.id,decidedAt:Date.now(),noticePending:true});
  await collection('role_requests').updateOne({_id:id},{$set:{status:record.status,decidedBy:record.decidedBy,decidedAt:record.decidedAt,noticePending:true}});
  try{await finish(i.guild,record);}catch(e){console.error('Role request completion pending:',id,e.code||e.name);await deliver(i.guild,record).catch(()=>{});return 'Decision saved. The role or panel update is pending and will retry automatically.';}
  return action==='approve'?'Approved. The role has been assigned.':'Denied. No role was assigned.';
 });
 await i.editReply(v2('Role Request Decision',result,[],true));
}
async function recover(client){
 const rows=await collection('role_requests').find({$or:[{noticePending:true},{status:'approving'}]}).toArray();
 for(const record of rows)try{await locked(`role-decision:${record._id}`,async()=>{
  const fresh=await collection('role_requests').findOne({_id:record._id});if(!fresh||(!fresh.noticePending&&fresh.status!=='approving'))return;
  await finish(await client.guilds.fetch(fresh.guildId),fresh);
 });}catch(e){console.error('Role request retry pending:',record._id,e.code||e.name);}
}
module.exports={hrRole,validate,reviewer,panel,submit,handle,recover};
