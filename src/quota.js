const D=require('discord.js');
const {collection,locked}=require('./store');
const {destination}=require('./discipline');
const {v2}=require('./panels');
const {requireAccess}=require('./access');
const MINIMUM=2*60*60000;
const QUOTA_ROLE='1540774157397000202';
function parts(ms,zone) {
 return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function localTime(y,m,d,h,zone) {
 const target=Date.UTC(y,m-1,d,h);let guess=target;
 for(let n=0;n<4;n++){const p=parts(guess,zone);guess+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
 return guess;
}
function nextSaturday(ms,zone='America/New_York') {
 const p=parts(ms,zone);const date=new Date(Date.UTC(p.year,p.month-1,p.day));
 let days=(6-date.getUTCDay()+7)%7;
 date.setUTCDate(date.getUTCDate()+days);
 let result=localTime(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),9,zone);
 if(result<=ms){date.setUTCDate(date.getUTCDate()+7);result=localTime(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),9,zone);}
 return result;
}
function totals(shifts,start,end) {
 const intervals=new Map(),map=new Map();
 for(const s of shifts){
  if(!Number.isFinite(s.started)||!(s.ended===null||Number.isFinite(s.ended)))continue;
  const a=Math.max(start,s.started),b=Math.min(end,s.ended===null?end:s.ended);
  if(b<=a)continue;
  if(!intervals.has(s.userId))intervals.set(s.userId,[]);
  intervals.get(s.userId).push([a,b]);
 }
 // Merge overlaps so duplicate legacy rows cannot inflate quota.
 for(const [id,spans] of intervals){
  spans.sort((a,b)=>a[0]-b[0]);let total=0,left=spans[0][0],right=spans[0][1];
  for(const [a,b] of spans.slice(1)){if(a>right){total+=right-left;left=a;}right=Math.max(right,b);}
  map.set(id,total+right-left);
 }
 return map;
}
function currentPeriod(state,now){let start=state.start,next=state.next;while(next<=now){start=next;next=nextSaturday(next,state.zone);}return {start,next};}
async function quotaState(guildId) {
 const rows=collection('quota');let state=await rows.findOne({_id:guildId});
 if(!state){const now=Date.now();await rows.updateOne({_id:guildId},{$setOnInsert:{enabled:true,zone:'America/New_York',start:now,next:nextSaturday(now)}},{upsert:true});state=await rows.findOne({_id:guildId});}
 return state;
}
function progress(ms) {return `${Math.floor(ms/60000)}m ${Math.floor(ms/1000)%60}s / 120m`;}
async function quotaCommand(i) {
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const action=i.options.getSubcommand();
 if(action!=='status')await requireAccess(i,'quota');
 return locked(`quota:${i.guildId}`,async()=>{
 let state=await quotaState(i.guildId);
 if(action==='disable') {
   await collection('quota').updateOne({_id:i.guildId},{$set:{enabled:false,changedBy:i.user.id,changedAt:Date.now()}});
   return i.editReply(v2('Quota Disabled','New weekly warnings and reports are paused. Already saved cases still finish recovery. Shift tracking still works. Re-enabling starts a fresh quota period.',[],true));
 }
 if(action==='enable'||action==='timezone') {
   let zone=state.zone;
   if(action==='timezone'){zone=i.options.getString('zone',true);try{parts(Date.now(),zone);}catch{throw new Error('Enter an IANA timezone, such as America/New_York.');}}
   if(action==='enable'&&state.enabled)return i.editReply(v2('Quota Enabled','Quota is already enabled; the current period was preserved.',[],true));
   const now=Date.now();await collection('quota').updateOne({_id:i.guildId},{$set:{enabled:action==='enable'?true:state.enabled,zone,start:now,next:nextSaturday(now,zone),changedBy:i.user.id}});
   return i.editReply(v2('Quota Updated',`Timezone: **${zone}**. New period starts now. Next deadline: <t:${Math.floor(nextSaturday(now,zone)/1000)}:F>.`,[],true));
 }
 const shifts=await collection('shifts').find({guildId:i.guildId,userId:i.user.id,}).toArray();
 const ms=totals(shifts,currentPeriod(state,Date.now()).start,Date.now()).get(i.user.id)||0;
 return i.editReply(v2('Weekly Shift Quota',`**Weekly time:** ${progress(ms)}\n**Quota:** ${state.enabled?'Enabled':'Disabled'}\n**Deadline:** <t:${Math.floor(currentPeriod(state,Date.now()).next/1000)}:F>\n**Timezone:** ${state.zone}\nActive shifts count toward the current period. Only the configured quota role receives automatic warnings.`,[],true));
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
     const shifts=await collection('shifts').find({guildId:guild.id,}).toArray();
     const time=totals(shifts,state.start,state.next);
     const missed=[...members.values()].filter(m=>!m.user.bot && (!m.joinedTimestamp||m.joinedTimestamp<=state.next)).filter(m=>m.roles.cache.has(QUOTA_ROLE)).filter(m=>(time.get(m.id)||0)<MINIMUM).map(m=>({id:m.id,name:m.user.username,time:time.get(m.id)||0}));
     report={_id:key,start:state.start,end:state.next,zone:state.zone,missed,sent:false};
     await collection('quota_reports').insertOne(report);
   }
   let pending=false;
   for(const member of report.missed){
     try { await require('./discipline').issueQuotaWarning(guild,member.id,report); }
     catch(e){pending=true;console.error('Quota warning pending:',key,member.id,e.code||e.name);}
   }
   if(pending)return;
   if(!report.sent) {
     const channel=await destination(guild,'infractions');
     const header=`Clearwater Fire Department — Weekly Quota Infraction List\nPeriod: ${new Date(report.start).toISOString()} to ${new Date(report.end).toISOString()}\nDeadline timezone: ${report.zone}\nRequired: 2 hours of shifts\nBelow quota: ${report.missed.length}\n`;
     const full=header+'\n'+report.missed.map((m,n)=>`${n+1}. ${m.name} (${m.id}) — ${progress(m.time)}`).join('\n');
     const preview=report.missed.slice(0,25).map(m=>`<@${m.id}> — ${progress(m.time)}`).join('\n')||'All eligible members completed quota.';
     const payload=v2('Weekly Quota Infraction List',`**Deadline:** <t:${Math.floor(report.end/1000)}:F>\n**Below quota:** ${report.missed.length}\n\n${preview}\n\nThe attached file contains the complete list. Automatic Warnings use the normal escalation rules. Members who left or no longer hold the quota role are skipped; saved cases remain in their history.`);
     payload.components[0].addFileComponents(new D.FileBuilder().setURL('attachment://quota-list.txt'));
     const message=await channel.send({...payload,files:[new D.AttachmentBuilder(Buffer.from(full),{name:'quota-list.txt'})],nonce:require('node:crypto').createHash('sha256').update(key).digest('hex').slice(0,24),enforceNonce:true});
     await collection('quota_reports').updateOne({_id:key},{$set:{sent:true,messageId:message.id}});
   }
   const start=state.next,next=nextSaturday(state.next,state.zone);
   await collection('quota').updateOne({_id:guild.id},{$set:{start,next}});
   state={...state,start,next};
 }
 });
}
let running=false;
async function tickQuota(client){
 if(running)return;running=true;
 try{for(const guild of client.guilds.cache.values()){
  if(guild.id!==require('./settings').GUILD_ID)continue;
  try{
   await processGuild(guild);
  }catch(e){console.error('Quota report pending:',guild.id,e.code||e.name);}
 }}finally{running=false;}
}
module.exports={QUOTA_ROLE,MINIMUM,quotaState,currentPeriod,nextSaturday,totals,progress,quotaCommand,tickQuota,processGuild};
