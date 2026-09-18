const D=require('discord.js');
const {collection,locked}=require('./store');
const {v2,button,row,section}=require('./panels');
const {requireAccess}=require('./access');
const {suggest}=require('./application-ai');
const REVIEW_CHANNEL='1538603960909168680';
const PASS_ROLES=['1538395272986755173','1539392349061255250'];
const QUESTIONS=[
 'Please state your Roblox username and ID.',
 'Do you have experience in any other whitelisted mafias? If so, which ones?',
 'Why are you interested in joining the Valenti Crime Family?',
 'Why should we pick you over other applicants?',
 'How familiar are you with ER:LC on a scale of 1-10?',
 'How active are you on a scale of 1-10?',
 'Do you understand that using AI for this application will result in a blacklist?',
 'Do you understand that you are required to do a ride along before you can go on duty by yourself?'
];
const apps=()=>collection('applications');
const safe=s=>D.escapeMarkdown(String(s));
function applicationPanel(){return v2('Valenti Crime Family Application Process',[
 'Become part of **Valenti Crime Family**. Select **Valenti Crime Family** below to begin your application in DMs.',
 section('preparation','Before You Begin','Enable direct messages from this server. Have your Roblox username and user ID ready, and allow time to answer all eight questions.'),
 section('step_1','Complete the Questions','Tell us about your experience, interest in Valenti, ER:LC knowledge, and availability. Write your own answers and answer honestly.'),
 section('step_2','Submit for Staff Review','The first six questions use written replies. The final two use Yes/No menus. Review the final prompt and press **Submit Application** when finished.'),
 section('review_queue','What Happens Next','Staff review your answers and make the decision. You will receive the result by DM when the bot can reach you. Submitting an application does not guarantee acceptance.'),
 section('ride_along','Required Ride Along','After acceptance, complete a ride along with a high rank before going on shift by yourself.'),
 section('saved','Need to Resume?','Your progress is saved. Select the application option again to continue. Type **cancel** during the DM questions if you want to stop.')
 ],[new D.StringSelectMenuBuilder().setCustomId('application:start').setPlaceholder('Begin or resume your application').addOptions({label:'Valenti Crime Family',description:'Eight questions • DM application • Staff review',value:'valenti'})]);}

function prompt(a){
 if(a.step===8)return v2('Application Ready', 'All eight answers are saved. Submit your application for staff review, or cancel it.',[button(`application:submit:${a._id}`,'Submit Application',D.ButtonStyle.Success),button(`application:cancel:${a._id}`,'Cancel',D.ButtonStyle.Secondary)]);
 const controls=a.step>=6?[new D.StringSelectMenuBuilder().setCustomId(`application:answer:${a._id}:${a.step}`).setPlaceholder('Select Yes or No').addOptions({label:'Yes',value:'Yes'},{label:'No',value:'No'})]:[];
 return v2(`${a.step+1}/8. ${QUESTIONS[a.step]}`,a.step<6?'Reply with your answer (up to 500 characters). Type cancel to stop. Your answers are saved; select the application panel again to resume.':'Choose Yes or No below.',controls);
}
async function sendPrompt(a,user){
 const sent=await user.send({...prompt(a),nonce:`${a._id}:${a.step}`,enforceNonce:true});
 await apps().updateOne({_id:a._id},{$set:{promptStep:a.step,promptId:sent.id}});
}
function validate(step,text){
 const value=String(text||'').trim();
 if(!value||value.length>500)throw new Error('Please send an answer between 1 and 500 characters.');
 if((step===4||step===5)&&! /^(?:[1-9]|10)$/.test(value))throw new Error('Please enter a whole number from 1 to 10.');
 if(step>=6&&!['Yes','No'].includes(value))throw new Error('Use the Yes or No dropdown.');
 return value;
}
async function answer(a,value,user){
 value=validate(a.step,value);
 const answers=[...a.answers,value];
 await apps().updateOne({_id:a._id},{$set:{answers,step:a.step+1,promptStep:-1}});
 await sendPrompt({...a,answers,step:a.step+1},user);
}
async function start(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 if(!i.inGuild())throw new Error('Start applications from the server panel.');
 await locked(`application-user:${i.user.id}`,async()=>{
  let a=await apps().findOne({userId:i.user.id,status:{$in:['collecting','submitted','accepting']}});
  if(a&&a.guildId!==i.guildId)throw new Error('Finish your existing application first.');
  if(a&&a.status!=='collecting')throw new Error('Your application is already awaiting staff review.');
  if(!a){a={_id:i.id,guildId:i.guildId,userId:i.user.id,status:'collecting',answers:[],step:0,promptStep:-1,created:Date.now()};await apps().insertOne(a);await appLog(a,'started');}
  try {await sendPrompt(a,i.user);}catch(e){if(e.code===50007)throw new Error('Enable DMs from server members, then select the application again. Your progress is saved.');throw e;}
 });
 await i.editReply(v2('Application Started','Check your DMs to answer the application questions.',[],true));
}
async function dm(message){
 if(message.guild||message.author.bot)return;
 try {
  await locked(`application-user:${message.author.id}`,async()=>{
   const a=await apps().findOne({userId:message.author.id,status:'collecting'});if(!a)return;
   if(message.content.trim().toLowerCase()==='cancel'){await apps().updateOne({_id:a._id},{$set:{status:'cancelled'}});await appLog(a,'cancelled');await message.author.send(v2('Application Cancelled','You may start again from the server panel.'));return;}
   if(a.promptStep!==a.step){await sendPrompt(a,message.author);return;}
   if(a.step>=6){await message.author.send(v2('Use the Controls',a.step===8?'Press Submit Application above.':'Choose Yes or No using the dropdown above.'));return;}
   if(BigInt(message.id)<=BigInt(a.promptId))return;
   await answer(a,message.content,message.author);
  });
 }catch(e){console.error('Application DM failed:',e.code||e.name);await message.author.send(v2('Application Not Completed',e.name==='Error'?e.message:'Your saved progress is safe. Try again or reselect the server application panel.')).catch(()=>{});}
}
function reviewPages(a){
 const header=`**Applicant:** <@${a.userId}> • **Application:** ${a._id}\n**Status:** ${a.status}\n\n`;
 const blocks=QUESTIONS.map((q,n)=>`**${n+1}/8. ${q}**\n${safe(a.answers[n])}\n\n`);
 blocks.push(`**AI suggestion (advisory):** ${safe(a.suggestion||'Pending')}\nStaff make the final decision. This does not detect AI-written answers.\n${a.reviewer?`**Reviewed by:** <@${a.reviewer}>`:''}`);
 const bodies=[];let body=header;
 for(const block of blocks){if(body.length+block.length>3500){bodies.push(body);body=header;}body+=block;}
 bodies.push(body);
 return bodies.map((text,page)=>v2(`Valenti Application • ${page+1}/${bodies.length}`,text,page===bodies.length-1?[button(`application:accept:${a._id}`,'Accept',D.ButtonStyle.Success).setDisabled(a.status!=='submitted'),button(`application:reject:${a._id}`,'Reject',D.ButtonStyle.Danger).setDisabled(a.status!=='submitted')]:[]));
}
async function reviewChannel(client,a){const guild=await client.guilds.fetch(a.guildId);const channel=await guild.channels.fetch(REVIEW_CHANNEL);if(!channel?.send)throw new Error('Application review channel is unavailable.');return channel;}
async function publish(client,a){
 if(!a.suggestion){a.suggestion=await suggest(a.answers);await apps().updateOne({_id:a._id},{$set:{suggestion:a.suggestion}});}
 const channel=await reviewChannel(client,a),pages=reviewPages(a),ids=[...(a.reviewIds||[])];
 for(let n=0;n<pages.length;n++){
  let message=ids[n]?await channel.messages.fetch(ids[n]).catch(e=>{if(e.code===10008)return null;throw e;}):null;
  if(!message){
   const nonce=`${a._id}:${n}`;
   // Adopt a delivered page if saving its ID failed.
   const recent=await channel.messages.fetch({limit:100});
   message=recent.find(m=>m.author.id===client.user.id&&String(m.nonce)===nonce);
   if(!message)message=await channel.send({...pages[n],nonce,enforceNonce:true});
  }else await message.edit(pages[n]);
  ids[n]=message.id;await apps().updateOne({_id:a._id},{$set:{reviewIds:ids}});
 }
 await apps().updateOne({_id:a._id},{$set:{reviewDirty:false}});
}
async function grant(client,a){
 const guild=await client.guilds.fetch(a.guildId),member=await guild.members.fetch({user:a.userId,force:true}),me=await guild.members.fetchMe();
 if(!me.permissions.has(D.PermissionFlagsBits.ManageRoles))throw new Error('The bot needs Manage Roles.');
 const roles=await Promise.all(PASS_ROLES.map(id=>guild.roles.fetch(id)));
 for(const role of roles)if(!role||role.managed||me.roles.highest.comparePositionTo(role)<=0)throw new Error('Both acceptance roles must exist below the bot role.');
 for(const role of roles)if(!member.roles.cache.has(role.id))await member.roles.add(role.id,`Application ${a._id} accepted by ${a.reviewer}`);
 await apps().updateOne({_id:a._id},{$set:{status:'accepted',reviewDirty:true}});a.status='accepted';await appLog(a,'accepted');
}
async function notify(client,a){
 if(a.notified||!['accepted','rejected'].includes(a.status))return;
 const user=await client.users.fetch(a.userId);
 try{await user.send(v2(a.status==='accepted'?'Application Accepted':'Application Rejected',a.status==='accepted'?'Welcome to Valenti Crime Family! Your roles have been added. Complete a ride along with a high rank before going on duty by yourself.':'Your Valenti Crime Family application was rejected by staff.'));}
 catch(e){if(e.code!==50007)throw e;}
 await apps().updateOne({_id:a._id},{$set:{notified:true}});
}
async function handle(i){
 if(i.customId==='application:start')return start(i);
 const [,action,id,step]=i.customId.split(':');
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 let a=await apps().findOne({_id:id});if(!a)throw new Error('Application not found.');
 if(['accept','reject'].includes(action)){
  if(!i.inGuild()||i.guildId!==a.guildId||i.channelId!==REVIEW_CHANNEL)throw new Error('Review applications in the configured review channel.');
  await requireAccess(i,'application');
  await locked(`application-user:${a.userId}`,async()=>{
   a=await apps().findOne({_id:id});
   if(a.status!=='submitted')throw new Error('This application has already been reviewed.');
   a={...a,status:action==='accept'?'accepting':'rejected',reviewer:i.user.id,reviewDirty:true};
   await apps().updateOne({_id:id},{$set:{status:a.status,reviewer:a.reviewer,reviewDirty:true}});
   if(action==='reject')await appLog(a,'rejected');
   if(action==='accept'){try{await grant(i.client,a);}catch(e){throw new Error('Acceptance saved, but role assignment is pending. Check that both roles exist below the bot and that it has Manage Roles. The bot will retry automatically.');}}
  });
  await i.editReply(v2('Decision Saved',action==='accept'?'Accepted. Both roles have been granted.':'Application rejected.',[],true));
  return;
 }
 if(i.inGuild()||a.userId!==i.user.id)throw new Error('Only the applicant can answer in DMs.');
 await locked(`application-user:${a.userId}`,async()=>{
  a=await apps().findOne({_id:id});if(a.status!=='collecting')throw new Error('This application is no longer collecting answers.');
  if(action==='cancel'){await apps().updateOne({_id:id},{$set:{status:'cancelled'}});await appLog(a,'cancelled');return;}
  if(action==='answer'){
   if(a.step!==Number(step)||a.promptId!==i.message.id)throw new Error('Use the latest question message.');
   await answer(a,i.values[0],i.user);return;
  }
  if(action==='submit'){
   if(a.step!==8||a.answers.length!==8)throw new Error('Complete all eight questions first.');
   await apps().updateOne({_id:id},{$set:{status:'submitted',submitted:Date.now(),reviewDirty:true}});await appLog(a,'submitted');return;
  }
  throw new Error('Unknown application action.');
 });
 await i.editReply(v2(action==='submit'?'Application Submitted':'Application Updated',action==='submit'?'Your answers are saved and queued for staff review.':action==='cancel'?'Application cancelled.':'Answer saved. Continue with the next DM.',[],true));
}
async function recoverApplications(client){
 const pending=await apps().find({$or:[{status:'collecting',promptStep:-1},{status:'accepting'},{reviewDirty:true},{status:{$in:['accepted','rejected']},notified:{$ne:true}}]}).toArray();
 for(const item of pending){try{await locked(`application-user:${item.userId}`,async()=>{
  const a=await apps().findOne({_id:item._id});
  if(a.status==='collecting'&&a.promptStep===-1){await sendPrompt(a,await client.users.fetch(a.userId));return;}
  if(a.status==='accepting')await grant(client,a);
  if(a.reviewDirty)await publish(client,a);
  await notify(client,a);
 });}catch(e){console.error('Application recovery pending:',item._id,e.code||e.name);}}
}
module.exports={applicationPanel,prompt,validate,reviewPages,start,dm,handle,recoverApplications,grant,PASS_ROLES,QUESTIONS};

async function appLog(a,event){await require('./logging').record('applications',a.guildId,`Application ${event}`,`**Applicant:** <@${a.userId}>\n**Application:** ${a._id}${a.reviewer?`\n**Reviewer:** <@${a.reviewer}>`:''}\n**Review channel:** <#${REVIEW_CHANNEL}>`,`${a._id}:${event}`);}
