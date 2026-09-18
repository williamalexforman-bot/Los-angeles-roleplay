const D=require('discord.js');
const {createHash,randomUUID}=require('node:crypto');
const {collection,locked}=require('./store');
const {v2}=require('./panels');
const CHANNELS=Object.fromEntries(['messages','infractions','promotions','claims','roles','raids','moderation','members'].map(k=>[k,null]));
const buffer=new Map();
const safe=(value,max=1200)=>D.escapeMarkdown(String(value??'Unavailable')).slice(0,max);
async function persist(row){try{await collection('event_logs').insertOne(row);}catch(e){if(e.code!==11000)throw e;}}
async function record(kind,guildId,title,body,key=randomUUID()){
 if(!Object.hasOwn(CHANNELS,kind))throw new Error('Unknown log type');
 const _id=createHash('sha256').update(`${kind}:${guildId}:${key}`).digest('hex').slice(0,24);
 const entry={_id,kind,guildId,title,body:String(body).slice(0,3500),created:Date.now(),nextAttempt:0,attempts:0,delivered:false};
 try{await persist(entry);}catch(e){
  if(buffer.size>=500&&!buffer.has(_id)){console.error('Event log startup buffer full; oldest unsaved event dropped.');buffer.delete(buffer.keys().next().value);}
  buffer.set(_id,entry);console.error('Event log queued in memory:',kind,e.code||e.name);
 }
}
async function flushLogs(client){
 for(const [id,row]of buffer){try{await persist(row);buffer.delete(id);}catch{break;}}
 const pending=await collection('event_logs').find({delivered:false,nextAttempt:{$lte:Date.now()}}).sort({created:1}).limit(25).toArray();
 for(const item of pending){
  try{await locked(`event-log:${item._id}`,async()=>{
   const fresh=await collection('event_logs').findOne({_id:item._id});if(!fresh||fresh.delivered)return;
   if(fresh.kind==='messages'&&fresh.title==='Message Sent') {
    await collection('event_logs').updateOne({_id:item._id},{$set:{delivered:true,suppressed:true,expires:new Date(Date.now()+7*86400000)}});
    return;
   }
   const guild=await client.guilds.fetch(item.guildId);
   const config=await require('./discipline').settings(item.guildId);
   if(!config['log_'+item.kind]){await collection('event_logs').updateOne({_id:item._id},{$set:{delivered:true,suppressed:true}});return;}
   const channel=await guild.channels.fetch(config['log_'+item.kind]);
   if(!channel?.send)throw new Error('Log channel unavailable');
   await channel.send({...v2(item.title,`${item.body}\n\n-# <t:${Math.floor(item.created/1000)}:F>`),nonce:item._id,enforceNonce:true});
   await collection('event_logs').updateOne({_id:item._id},{$set:{delivered:true,expires:new Date(Date.now()+7*86400000)}});
  });}catch(e){
   const attempts=(item.attempts||0)+1;
   await collection('event_logs').updateOne({_id:item._id},{$set:{attempts,nextAttempt:Date.now()+Math.min(300000,10000*2**Math.min(attempts,5))}}).catch(()=>{});
   console.error('Event log delivery pending:',item.kind,e.code||e.name);
  }
 }
}
function trackRaid(joins,guildId,userId,now=Date.now()){
 const state=joins.get(guildId)||{members:[],lastAlert:0};
 state.members=state.members.filter(x=>now-x.at<60000);
 if(!state.members.some(x=>x.id===userId))state.members.push({id:userId,at:now});
 const alert=state.members.length>=10&&now-state.lastAlert>=300000;
 if(alert)state.lastAlert=now;
 if(state.members.length>100)state.members=state.members.slice(-100);
 joins.set(guildId,state);return alert?state.members.length:0;
}
function isThreat(text){return /\b(?:raid(?:ing)?\s+(?:this|your|the)\s+server|(?:going\s+to|gonna|will|lets|let's)\s+raid)\b/i.test(text||'');}
function registerLogs(client){
 const joins=new Map();
 const eligible=g=>g&&(!process.env.GUILD_ID?.trim()||g.id===process.env.GUILD_ID.trim());
 const on=(event,fn)=>client.on(event,(...args)=>{void Promise.resolve().then(()=>fn(...args)).catch(e=>console.error('Event logger failed:',event,e.code||e.name));});
 const valid=m=>eligible(m.guild)&&!m.author?.bot&&!m.webhookId&&!Object.values(CHANNELS).includes(m.channelId);
 const header=m=>`**Member:** ${m.author?`<@${m.author.id}> (${m.author.id})`:'Unknown (message not cached)'}\n**Channel:** <#${m.channelId}>\n**Message ID:** ${m.id}`;
 const attachments=m=>m.attachments?.size?'\n**Attachments:**\n'+[...m.attachments.values()].slice(0,5).map(a=>safe(a.url,300)).join('\n'):'';
 on('messageCreate',async m=>{
  if(!valid(m))return;
  if(isThreat(m.content))await record('raids',m.guild.id,'Possible Raid Threat',`${header(m)}\n[Review message](${m.url})\n\n${safe(m.content)}\n\nKeyword alert only. Staff must verify; no automatic punishment.`,`threat:${m.id}`);
 });
 on('messageUpdate',async(old,m)=>{
  if(!valid(m))return;
  if(m.partial)try{m=await m.fetch();}catch{return;}
  if(!valid(m)||old.content===m.content)return;
  await record('messages',m.guild.id,'Message Edited',`${header(m)}\n[Jump to message](${m.url})\n\n**Before:**\n${safe(old.content)}\n\n**After:**\n${safe(m.content)}`,`edit:${m.id}:${m.editedTimestamp}`);
  if(isThreat(m.content))await record('raids',m.guild.id,'Possible Raid Threat',`${header(m)}\n${safe(m.content)}\n[Review message](${m.url})\n\nKeyword alert only; staff verification required.`,`threat:${m.id}`);
 });
 on('messageDelete',m=>valid(m)?record('messages',m.guild.id,'Message Deleted',`${header(m)}\n\n${safe(m.content)}${attachments(m)}`,`deleted:${m.id}`):undefined);
 on('messageDeleteBulk',async messages=>{
  for(const m of messages.values())if(valid(m))await record('messages',m.guild.id,'Message Deleted (Bulk)',`${header(m)}\n\n${safe(m.content)}${attachments(m)}`,`deleted:${m.id}`);
 });
 on('guildMemberAdd',async m=>{
  if(!eligible(m.guild))return;
  await record('members',m.guild.id,'Member Joined',`**Member:** <@${m.id}> (${m.id})\n**Account created:** <t:${Math.floor(m.user.createdTimestamp/1000)}:F>`, `join:${m.id}:${m.joinedTimestamp}`);
  if(!m.user.bot){const count=trackRaid(joins,m.guild.id,m.id);if(count)await record('raids',m.guild.id,'Unusual Join Activity',`${count} members joined within 60 seconds. Possible raid activity; verify before taking action.\n**Latest member:** <@${m.id}>`);}
 });
 on('guildMemberRemove',m=>eligible(m.guild)?record('members',m.guild.id,'Member Left',`**Member:** <@${m.id}> (${m.id})\nDeparture does not by itself establish a kick or ban.`):undefined);
 on('guildMemberUpdate',async(old,m)=>{
  if(!eligible(m.guild)||old.partial)return;
  const added=[...m.roles.cache.keys()].filter(id=>!old.roles.cache.has(id)),removed=[...old.roles.cache.keys()].filter(id=>!m.roles.cache.has(id));
  if(!added.length&&!removed.length)return;
  await record('roles',m.guild.id,'Member Roles Changed',`**Member:** <@${m.id}> (${m.id})\n**Added:** ${added.map(id=>`<@&${id}>`).join(', ')||'None'}\n**Removed:** ${removed.map(id=>`<@&${id}>`).join(', ')||'None'}`);
 });
 on('roleCreate',r=>eligible(r.guild)?record('roles',r.guild.id,'Role Created',`**Role:** ${safe(r.name)} (${r.id})`,`create:${r.id}`):undefined);
 on('roleDelete',r=>eligible(r.guild)?record('roles',r.guild.id,'Role Deleted',`**Role:** ${safe(r.name)} (${r.id})`,`delete:${r.id}`):undefined);
 on('roleUpdate',async(old,r)=>{
  if(!eligible(r.guild))return;
  const changes=[];
  for(const key of ['name','hexColor','hoist','mentionable','position'])if(old[key]!==r[key])changes.push(`**${key}:** ${safe(old[key],150)} → ${safe(r[key],150)}`);
  if(old.permissions.bitfield!==r.permissions.bitfield)changes.push(`**Permissions:** ${old.permissions.bitfield} → ${r.permissions.bitfield}`);
  if(changes.length)await record('roles',r.guild.id,'Role Updated',`**Role:** <@&${r.id}> (${r.id})\n${changes.join('\n')}`);
 });
 on('guildBanAdd',b=>eligible(b.guild)?record('moderation',b.guild.id,'Member Banned',`**Member:** <@${b.user.id}> (${b.user.id})\n**Reason:** ${safe(b.reason||'Not supplied with this event')}`):undefined);
 on('guildBanRemove',b=>eligible(b.guild)?record('moderation',b.guild.id,'Member Unbanned',`**Member:** <@${b.user.id}> (${b.user.id})`):undefined);
 on('guildAuditLogEntryCreate',async(entry,guild)=>{
  if(!eligible(guild)||entry.action!==D.AuditLogEvent.MemberKick)return;
  await record('moderation',guild.id,'Member Kicked',`**Member:** <@${entry.targetId}> (${entry.targetId})\n**Moderator:** ${entry.executorId?`<@${entry.executorId}>`:'Unavailable'}\n**Reason:** ${safe(entry.reason||'Not provided')}`,`kick:${entry.id}`);
 });
}
module.exports={CHANNELS,record,flushLogs,registerLogs,trackRaid,isThreat};
