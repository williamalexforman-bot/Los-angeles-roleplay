const D=require('discord.js');
const {collection,locked}=require('./store');
const {destination}=require('./discipline');
const {v2}=require('./panels');
const {requireAccess}=require('./access');
const MINIMUM=30*60000;
function parts(ms,zone) {
 return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function localTime(y,m,d,h,zone) {
 const target=Date.UTC(y,m-1,d,h);let guess=target;
 for(let n=0;n<4;n++){const p=parts(guess,zone);guess+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
 return guess;
}
function nextFriday(ms,zone='America/New_York') {
 const p=parts(ms,zone);const date=new Date(Date.UTC(p.year,p.month-1,p.day));
 let days=(5-date.getUTCDay()+7)%7;
 date.setUTCDate(date.getUTCDate()+days);
 let result=localTime(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),10,zone);
 if(result<=ms){date.setUTCDate(date.getUTCDate()+7);result=localTime(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),10,zone);}
 return result;
}
function totals(shifts,start,end) {
 const map=new Map();
 for(const s of shifts) {
  if(!Number.isFinite(s.ended)||s.ended>end)continue;
  const time=Math.max(0,Math.min(s.ended,end)-Math.max(s.started,start));
  map.set(s.userId,(map.get(s.userId)||0)+time);
 }
 return map;
}
async function quotaState(guildId) {
 const rows=collection('quota');let state=await rows.findOne({_id:guildId});
 if(!state){const now=Date.now();await rows.updateOne({_id:guildId},{$setOnInsert:{enabled:true,zone:'America/New_York',start:now,next:nextFriday(now)}},{upsert:true});state=await rows.findOne({_id:guildId});}
 return state;
}
function progress(ms) {return `${Math.floor(ms/60000)}m ${Math.floor(ms/1000)%60}s / 30m`;}
async function quotaCommand(i) {
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const action=i.options.getSubcommand();
 if(action!=='status')await requireAccess(i,'quota');
 return locked(`quota:${i.guildId}`,async()=>{
 let state=await quotaState(i.guildId);
 if(action==='disable') {
   await collection('quota').updateOne({_id:i.guildId},{$set:{enabled:false,changedBy:i.user.id,changedAt:Date.now()}});
   return i.editReply(v2('Quota Disabled','Weekly reports are paused. Shift tracking still works. Re-enabling starts a fresh quota period.',[],true));
 }
 if(action==='enable'||action==='timezone') {
   let zone=state.zone;
   if(action==='timezone'){zone=i.options.getString('zone',true);try{parts(Date.now(),zone);}catch{throw new Error('Enter an IANA timezone, such as America/New_York.');}}
   if(action==='enable'&&state.enabled)return i.editReply(v2('Quota Enabled','Quota is already enabled; the current period was preserved.',[],true));
   const now=Date.now();await collection('quota').updateOne({_id:i.guildId},{$set:{enabled:action==='enable'?true:state.enabled,zone,start:now,next:nextFriday(now,zone),changedBy:i.user.id}});
   return i.editReply(v2('Quota Updated',`Timezone: **${zone}**. New period starts now. Next deadline: <t:${Math.floor(nextFriday(now,zone)/1000)}:F>.`,[],true));
 }
 const shifts=await collection('shifts').find({guildId:i.guildId,userId:i.user.id,ended:{$ne:null}}).toArray();
 const ms=totals(shifts,state.start,Date.now()).get(i.user.id)||0;
 return i.editReply(v2('Weekly Shift Quota',`**Saved time:** ${progress(ms)}\n**Quota:** ${state.enabled?'Enabled':'Disabled'}\n**Deadline:** <t:${Math.floor(state.next/1000)}:F>\n**Timezone:** ${state.zone}\nEnd your shift to save time toward quota.`,[],true));
 });
}
async function processGuild(guild) {
 return locked(`quota:${guild.id}`,async()=>{
 let state=await quotaState(guild.id);const now=Date.now();
 if(!state.enabled)return;
 // Process each missed deadline from the persisted cursor. Do not regenerate a
 // saved report from changing member lists or shift records on a delivery retry.
 let count=0;
 while(state.next<=now && count++<10) {
   const key=`${guild.id}:${state.next}`;let report=await collection('quota_reports').findOne({_id:key});
   if(!report) {
     const members=await guild.members.fetch();
     const shifts=await collection('shifts').find({guildId:guild.id,ended:{$ne:null}}).toArray();
     const time=totals(shifts,state.start,state.next);
     const missed=[...members.values()].filter(m=>!m.user.bot && (!m.joinedTimestamp||m.joinedTimestamp<=state.next)).filter(m=>(time.get(m.id)||0)<MINIMUM).map(m=>({id:m.id,name:m.user.username,time:time.get(m.id)||0}));
     report={_id:key,start:state.start,end:state.next,zone:state.zone,missed,sent:false};
     await collection('quota_reports').insertOne(report);
   }
   if(!report.sent) {
     const channel=await destination(guild,'infractions');
     const header=`Valenti Crime Family — Weekly Quota Infraction List\nPeriod: ${new Date(report.start).toISOString()} to ${new Date(report.end).toISOString()}\nDeadline timezone: ${report.zone}\nRequired: 30 minutes of completed shifts\nBelow quota: ${report.missed.length}\n`;
     const full=header+'\n'+report.missed.map((m,n)=>`${n+1}. ${m.name} (${m.id}) — ${progress(m.time)}`).join('\n');
     const preview=report.missed.slice(0,25).map(m=>`<@${m.id}> — ${progress(m.time)}`).join('\n')||'All current members completed quota.';
     const payload=v2('Weekly Quota Infraction List',`**Deadline:** <t:${Math.floor(report.end/1000)}:F>\n**Below quota:** ${report.missed.length}\n\n${preview}\n\nThe attached file contains the complete list. This report does not automatically issue warnings or strikes.`);
     payload.components[0].addFileComponents(new D.FileBuilder().setURL('attachment://quota-list.txt'));
     const message=await channel.send({...payload,files:[new D.AttachmentBuilder(Buffer.from(full),{name:'quota-list.txt'})],nonce:require('node:crypto').createHash('sha256').update(key).digest('hex').slice(0,24),enforceNonce:true});
     await collection('quota_reports').updateOne({_id:key},{$set:{sent:true,messageId:message.id}});
   }
   const start=state.next,next=nextFriday(state.next,state.zone);
   await collection('quota').updateOne({_id:guild.id},{$set:{start,next}});
   state={...state,start,next};
 }
 });
}
let running=false;
async function tickQuota(client){if(running)return;running=true;try{for(const guild of client.guilds.cache.values())await processGuild(guild).catch(e=>console.error('Quota report pending:',guild.id,e.code||e.name));}finally{running=false;}}
module.exports={nextFriday,totals,progress,quotaCommand,tickQuota,processGuild};
