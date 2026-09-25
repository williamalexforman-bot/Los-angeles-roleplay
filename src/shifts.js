const D = require('discord.js');
const { collection, locked } = require('./store');
const { ROLES } = require('./settings');
const { v2, button, section } = require('./panels');
function duration(ms) {
 const minutes=Math.floor(Math.max(0,ms)/60000);
 return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function shiftPanel() {
 return v2('Shift Management',[section('on_duty','Begin Your Shift','Use `/shift` for private controls. Start, break, and end buttons update your saved shift and configured duty roles.'),section('quota','Weekly Requirement','Members assigned the quota role must complete **2 hours** by **Saturday at 9 AM Eastern**. Missing the requirement automatically issues a Warning.')],[],false,'shift');
}
async function shiftRoles(i,state){
 const config=await require('./discipline').settings(i.guildId),member=await i.guild.members.fetch({user:i.user.id,force:true});
 if(!member.roles?.add||!member.roles?.remove)return;
 const duty=config.role_on_duty,away=config.role_on_break;
 if(state==='duty'){if(duty)await member.roles.add(duty,'Shift started/resumed');if(away)await member.roles.remove(away,'Shift resumed').catch(()=>{});}
 if(state==='break'){if(away)await member.roles.add(away,'Shift break started');if(duty)await member.roles.remove(duty,'Shift break started').catch(()=>{});}
 if(state==='off'){for(const id of [duty,away].filter(Boolean))await member.roles.remove(id,'Shift ended').catch(()=>{});}
}
async function viewShift(i,userId=i.user.id) {
 const {quotaState,currentPeriod,totals,QUOTA_ROLE,MINIMUM}=require('./quota');
 const member=await i.guild.members.fetch({user:userId,force:true});
 const state=await quotaState(i.guildId),now=Date.now(),period=currentPeriod(state,now);
 const rows=await collection('shifts').find({guildId:i.guildId,userId}).toArray();
 const active=rows.find(s=>s.ended===null),time=totals(rows,period.start,now).get(userId)||0;
 const required=member.roles.cache.has(QUOTA_ROLE);
 return `**Member:** <@${userId}>\n**Current shift:** ${active?duration(now-active.started)+' (on duty)':'Off duty'}\n**Weekly time:** ${duration(time)}\n**Quota:** ${required?'2h 0m — '+(time>=MINIMUM?'Complete':duration(MINIMUM-time)+' remaining'):'Not required'}\n**Enforcement:** ${state.enabled?'Enabled':'Disabled'}\n**Deadline:** <t:${Math.floor(period.next/1000)}:F>\n**Saved lifetime time:** ${duration(rows.filter(s=>Number.isFinite(s.ended)).reduce((sum,s)=>sum+Math.max(0,s.ended-s.started),0))}\nActive time counts toward this week; crossing the deadline splits time between weeks.`;
}
async function changeShift(i,action,targetId) {
 if(['status','view'].includes(action))return viewShift(i,targetId||i.user.id);
 return locked(`shift:${i.guildId}:${i.user.id}`,async()=>{
  const rows=collection('shifts'),active=await rows.findOne({guildId:i.guildId,userId:i.user.id,ended:null});
  if(action==='end'){
   if(!active)return 'You are not currently on shift.';
   const ended=Date.now(),breakMs=(active.breakMs||0)+(active.breakStarted?ended-active.breakStarted:0);await rows.updateOne({_id:active._id,ended:null},{$set:{ended,breakStarted:null,breakMs,duration:Math.max(0,ended-active.started-breakMs)}});await shiftRoles(i,'off');
   return `Shift ended. **Time worked:** ${duration(ended-active.started)}. Your record is saved.`;
  }
  if(action==='break'){
   if(!active)return 'Start your shift before going on break.';
   if(active.breakStarted){const now=Date.now();await rows.updateOne({_id:active._id},{$set:{breakStarted:null},$inc:{breakMs:now-active.breakStarted}});await shiftRoles(i,'duty');return 'Break ended. You are back on duty.';}
   await rows.updateOne({_id:active._id},{$set:{breakStarted:Date.now()}});await shiftRoles(i,'break');return 'Break started. Your On Break role has been updated.';
  }
  if(action!=='start')throw new Error('Invalid shift action.');
  const member=await i.guild.members.fetch({user:i.user.id,force:true});
  const discipline=await collection('members').findOne({_id:`${i.guildId}:${i.user.id}`});
  if(discipline?.suspension||member.roles.cache.has(ROLES.suspended))throw new Error('You cannot start a shift while suspended.');
  if(active)return `You already have an active shift, started <t:${Math.floor(active.started/1000)}:R>.`;
  await require('./quota').quotaState(i.guildId);
  await rows.insertOne({_id:i.id||i.sourceMessageId,guildId:i.guildId,userId:i.user.id,started:Date.now(),ended:null,breakMs:0,breakStarted:null});await shiftRoles(i,'duty');
  return 'Shift started. Your start time is saved.';
 });
}
async function handleShift(i,action){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const target=action==='view'?i.options.getUser('member')?.id:undefined;
 await i.editReply(v2('Shift Status',await changeShift(i,action,target),[],true));
}
async function showControls(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const active=await collection('shifts').findOne({guildId:i.guildId,userId:i.user.id,ended:null});
 const body=active?`Hello <@${i.user.id}>! You are currently **${active.breakStarted?'on break':'on duty'}**. Choose an option below.`:`Hello <@${i.user.id}>! Are you ready to start your shift? Press **Start** below.`;
 const controls=active?[button('shift:break',active.breakStarted?'Resume':'Break',D.ButtonStyle.Secondary),button('shift:end','End',D.ButtonStyle.Danger)]:[button('shift:start','Start',D.ButtonStyle.Success)];
 return i.editReply(v2('Shift Controls',body,controls,true));
}
module.exports={shiftPanel,changeShift,viewShift,handleShift,showControls,duration};
