const D=require('discord.js');
const {collection,locked}=require('./store');
const {ROLES}=require('./settings');
const {caseNotice,NOTICE_VERSION}=require('./legacy-layout');
function caseId(value){const id=String(value).trim().replace(/^INF-/i,'');if(!/^(?:\d{17,20}|quota-\d{13}-\d{17,20})$/.test(id))throw new Error('Enter the Case ID shown on the infraction, with or without INF-.');return id;}
const tiers=[...ROLES.warnings,...ROLES.strikes];
const statusRole=type=>({Termination:ROLES.termination,Blacklisted:ROLES.blacklisted,'Under Investigation':ROLES.investigation}[type]);
function revokePlan(state,cases,item){
 const active=cases.filter(c=>!c.revoked&&c._id!==item._id).sort((a,b)=>a.created-b.created||a._id.localeCompare(b._id));
 let counts={warnings:0,strikes:0};for(const c of active)counts=require('./discipline').advance(counts,c.type);
 const next={...state,warnings:counts.warnings,strikes:counts.strikes,total:active.length};
 const desired=[ROLES.warnings[counts.warnings-1],ROLES.strikes[Math.min(counts.strikes,2)-1]].filter(Boolean);
 const marker=statusRole(item.type),removeMarker=marker&&!active.some(c=>statusRole(c.type)===marker)?marker:null;
 const obsolete=new Set([...tiers,ROLES.suspended,removeMarker].filter(Boolean));
 const add=[],remove=[];
 if(state.suspension){
  const source=active.find(c=>c._id===state.suspension.caseId);
  const keep=source&&(source.type==='Suspension'||counts.strikes>=3);
  const saved=state.suspension.roles.filter(id=>!obsolete.has(id));
  if(keep)next.suspension={...state.suspension,roles:[...new Set([...saved,...desired])]};
  else{delete next.suspension;add.push(...saved,...desired);remove.push(ROLES.suspended);}
 }
 if(!next.suspension){add.push(...desired);remove.push(...tiers.filter(id=>!desired.includes(id)));}
 if(removeMarker)remove.push(removeMarker);
 return {next,add:[...new Set(add)],remove:[...new Set(remove)]};
}
async function pending(guildId,userId){return collection('case_changes').findOne({guildId,userId,status:'prepared'});}
async function apply(guild,change){
 if(change.status==='prepared'){
  if(change.action==='revoke'){
   const member=await guild.members.fetch({user:change.userId,force:true});
   for(const id of change.add)if(!member.roles.cache.has(id))await member.roles.add(id,`Revoke INF-${change.caseId}`);
   for(const id of change.remove)if(!change.add.includes(id)&&member.roles.cache.has(id))await member.roles.remove(id,`Revoke INF-${change.caseId}`);
   await collection('members').replaceOne({_id:change.next._id},change.next,{upsert:true});
  }
  await collection('cases').updateOne({_id:change.caseId,guildId:change.guildId},{$set:change.patch});
  await collection('case_changes').updateOne({_id:change._id},{$set:{status:'applied'}});change.status='applied';
 }
 const item=await collection('cases').findOne({_id:change.caseId,guildId:change.guildId});
 if(item.messageId){
  const channel=await guild.channels.fetch(item.logChannel);
  const message=await channel.messages.fetch(item.messageId).catch(e=>{if(e.code===10008)return null;throw e;});
  if(message)await message.edit({...caseNotice(item),content:null,embeds:[]});
 }
 await require('./logging').record('infractions',guild.id,change.action==='revoke'?'Infraction Revoked':'Infraction Edited',`**Case:** INF-${item._id}\n**Member:** <@${item.userId}>\n**Changed by:** <@${change.actorId}>\n**Reason:** ${D.escapeMarkdown(change.reason)}\n**Fields:** ${change.action==='edit'?Object.keys(change.after).join(', '):'Revoked; active counts and applicable roles recalculated.'}`,change._id);
 await collection('cases').updateOne({_id:item._id},{$set:{noticeVersion:NOTICE_VERSION}});
 await collection('case_changes').updateOne({_id:change._id},{$set:{status:'done',completed:Date.now()}});
}
async function change(i,action,id,updates,reason){
 await require('./access').requireAccess(i,'infraction');
 id=caseId(id);reason=String(reason||'').trim();if(!reason||reason.length>500)throw new Error('Enter a change reason between 1 and 500 characters.');
 const query={_id:id,guildId:i.guildId,kind:'infraction'};
 const initial=await collection('cases').findOne(query);if(!initial)throw new Error('No infraction with that Case ID exists in this server.');
 return locked(`member:${i.guildId}:${initial.userId}`,async()=>{
  const duplicate=await collection('case_changes').findOne({_id:i.id});if(duplicate)return 'This change is already saved; pending work retries automatically.';
  if(await pending(i.guildId,initial.userId))throw new Error('A previous role change is still pending. Wait for recovery before changing this record.');
  if(await collection('case_changes').findOne({caseId:id,status:'applied'}))throw new Error('A previous notice update is pending for this case. Please try again once it finishes.');
  const item=await collection('cases').findOne(query);
  if(item.revoked)throw new Error('This infraction has already been revoked. Its record is retained for auditing.');
  if(item.status!=='logged')throw new Error('This infraction is still being applied or posted. Wait for it to finish.');
  const stamp={actorId:i.user.id,at:Date.now(),reason};
  const entry={_id:i.id,caseId:id,guildId:i.guildId,userId:item.userId,actorId:i.user.id,reason,action,created:stamp.at,status:'prepared'};
  if(action==='edit'){
   const limits={reason:1024,notes:800,evidence:800};const patch={};
   for(const [key,value]of Object.entries(updates)){
    if(key==='appealable'){if(typeof value!=='boolean')throw new Error('Appealable must be yes or no.');patch[key]=value;}
    else if(limits[key]){const text=String(value).trim();if(!text||text.length>limits[key])throw new Error(`${key} must contain 1–${limits[key]} characters.`);patch[key]=text;}
    else throw new Error('That field cannot be edited. Revoke and reissue to change the action or recipient.');
   }
   if(!Object.keys(patch).length)throw new Error('Choose at least one field to edit.');
   entry.before=Object.fromEntries(Object.keys(patch).map(k=>[k,item[k]]));entry.after=patch;
   entry.patch={...patch,lastEdited:stamp,noticeVersion:0};
  }else if(action==='revoke'){
   const cases=await collection('cases').find({guildId:i.guildId,userId:item.userId,kind:'infraction'}).toArray();
   if(cases.some(c=>['prepared','applied'].includes(c.status)))throw new Error('Another infraction for this member is still being applied or posted. Wait for recovery.');
   if(await collection('cases').findOne({guildId:i.guildId,userId:item.userId,status:'prepared'}))throw new Error('A member role change is pending. Wait for recovery.');
   const state=await collection('members').findOne({_id:`${i.guildId}:${item.userId}`});if(!state)throw new Error('The saved member record is missing. No changes were made.');
   const plan=revokePlan(state,cases,item);
   const member=await i.guild.members.fetch({user:item.userId,force:true});const me=await i.guild.members.fetchMe();await i.guild.roles.fetch();
   const changes=[...plan.add.filter(id=>!member.roles.cache.has(id)),...plan.remove.filter(id=>member.roles.cache.has(id))];
   if(changes.length&&!me.permissions.has(D.PermissionFlagsBits.ManageRoles))throw new Error('The bot needs Manage Roles to revoke this infraction.');
   for(const roleId of changes){const role=i.guild.roles.cache.get(roleId);if(!role||role.managed||role.id===i.guildId||me.roles.highest.comparePositionTo(role)<=0)throw new Error('A role needed for revocation is missing, managed, or above the bot. No changes were made.');}
   Object.assign(entry,plan,{before:{revoked:false,counts:{warnings:state.warnings,strikes:state.strikes,total:state.total}},after:{revoked:true,counts:{warnings:plan.next.warnings,strikes:plan.next.strikes,total:plan.next.total}}});
   entry.patch={revoked:stamp,noticeVersion:0};
  }else throw new Error('Unknown change action.');
  const preview=caseNotice({...item,...entry.patch});let textLength=0;
  const count=c=>{textLength+=(c.content||'').length;for(const child of c.components||[])count(child);};
  preview.components.forEach(c=>count(c.toJSON()));
  if(textLength>4000)throw new Error('The updated notice exceeds Discord’s text limit. Shorten the reason, notes or evidence before saving.');
  await collection('case_changes').insertOne(entry);
  try{await apply(i.guild,entry);}catch(e){console.error('Infraction change pending:',entry._id,e.code||e.name);return `Change saved for INF-${id}. Role or notice updates are pending and will retry automatically. Do not submit it again.`;}
  return `INF-${id} ${action==='edit'?'updated':'revoked'}. The original record and change history are retained.`;
 });
}
async function recover(client){
 for(const entry of await collection('case_changes').find({status:{$in:['prepared','applied']}}).toArray()){
  try{await locked(`member:${entry.guildId}:${entry.userId}`,async()=>{const fresh=await collection('case_changes').findOne({_id:entry._id});if(!fresh||fresh.status==='done')return;await apply(await client.guilds.fetch(entry.guildId),fresh);});}
  catch(e){console.error('Infraction change retry pending:',entry._id,e.code||e.name);}
 }
}
module.exports={caseId,revokePlan,pending,change,recover};
