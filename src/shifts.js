const D = require('discord.js');
const { collection, locked } = require('./store');
const { ROLES } = require('./settings');
const { v2, button, section } = require('./panels');
function duration(ms) {
 const minutes=Math.floor(Math.max(0,ms)/60000);
 return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function shiftPanel() {
 return v2('Shift Management',[section('on_duty','Begin Your Shift','Start the timer when you report for duty and end it when you finish. Every timestamp is saved automatically.'),section('quota','Weekly Requirement','Members assigned the quota role must complete **2 hours** by **Saturday at 9 AM Eastern**. Missing the requirement automatically issues a Warning.'),section('duration','Review Shift Time','Use `/shift view member:` to review current duty time and weekly progress. A separate shift-log channel is not required.')],[button('shift:start','Start Shift',D.ButtonStyle.Success),button('shift:end','End Shift',D.ButtonStyle.Danger),button('shift:status','View My Shift')],false,'shift');
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
   const ended=Date.now();await rows.updateOne({_id:active._id,ended:null},{$set:{ended,duration:Math.max(0,ended-active.started)}});
   return `Shift ended. **Time worked:** ${duration(ended-active.started)}. Your record is saved.`;
  }
  if(action!=='start')throw new Error('Invalid shift action.');
  const member=await i.guild.members.fetch({user:i.user.id,force:true});
  const discipline=await collection('members').findOne({_id:`${i.guildId}:${i.user.id}`});
  if(discipline?.suspension||member.roles.cache.has(ROLES.suspended))throw new Error('You cannot start a shift while suspended.');
  if(active)return `You already have an active shift, started <t:${Math.floor(active.started/1000)}:R>.`;
  await require('./quota').quotaState(i.guildId);
  await rows.insertOne({_id:i.id||i.sourceMessageId,guildId:i.guildId,userId:i.user.id,started:Date.now(),ended:null});
  return 'Shift started. Your start time is saved.';
 });
}
async function handleShift(i,action){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 const target=action==='view'?i.options.getUser('member')?.id:undefined;
 await i.editReply(v2('Shift Status',await changeShift(i,action,target),[],true));
}
module.exports={shiftPanel,changeShift,viewShift,handleShift,duration};
