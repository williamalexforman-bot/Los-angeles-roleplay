const D=require('discord.js');
const {collection,locked}=require('./store');
const {requireAccess}=require('./access');

const CONTROLLED=[
 D.PermissionFlagsBits.SendMessages,
 D.PermissionFlagsBits.AddReactions,
 D.PermissionFlagsBits.CreatePublicThreads,
 D.PermissionFlagsBits.CreatePrivateThreads,
 D.PermissionFlagsBits.SendMessagesInThreads,
];
const DENIED={SendMessages:false,AddReactions:false,CreatePublicThreads:false,CreatePrivateThreads:false,SendMessagesInThreads:false};

function state(overwrite,flag){
 if(overwrite?.allow?.has(flag))return true;
 if(overwrite?.deny?.has(flag))return false;
 return null;
}
function snapshot(overwrite,id,type){return {id,type,had:Boolean(overwrite),permissions:CONTROLLED.map(flag=>state(overwrite,flag))};}
function restorePayload(saved){return Object.fromEntries(['SendMessages','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads'].map((name,index)=>[name,saved.permissions[index]]));}
function supported(channel){return [D.ChannelType.GuildText,D.ChannelType.GuildAnnouncement].includes(channel?.type);}
async function botCheck(context){
 if(!supported(context.channel))throw new Error('Use this command in a server text or announcement channel. Threads must be locked from their parent channel.');
 const me=await context.guild.members.fetchMe();
 if(!me.permissions.has(D.PermissionFlagsBits.ManageChannels))throw new Error('The bot needs Manage Channels to lock or unlock this channel.');
 return me;
}
async function lockChannel(context){
 await requireAccess(context,'management');await botCheck(context);
 return locked(`channel-lock:${context.channelId}`,async()=>{
  const rows=collection('channel_locks');
  if(await rows.findOne({_id:context.channelId}))return 'This channel is already locked.';
  const cache=context.channel.permissionOverwrites.cache;
  const targets=new Map([[context.guild.id,{id:context.guild.id,type:D.OverwriteType.Role,overwrite:cache.get(context.guild.id)}]]);
  for(const overwrite of cache.values())if(CONTROLLED.some(flag=>overwrite.allow.has(flag)))targets.set(overwrite.id,{id:overwrite.id,type:overwrite.type,overwrite});
  const saved=[...targets.values()].map(target=>snapshot(target.overwrite,target.id,target.type));
  const record={_id:context.channelId,guildId:context.guild.id,lockedBy:context.user.id,lockedAt:Date.now(),saved};
  await rows.insertOne(record);
  try{for(const target of saved)await context.channel.permissionOverwrites.edit(target.id,DENIED,{type:target.type,reason:`Channel locked by ${context.user.id}`});}
  catch(error){
   for(const target of saved)try{if(target.had)await context.channel.permissionOverwrites.edit(target.id,restorePayload(target),{type:target.type});else await context.channel.permissionOverwrites.delete(target.id);}catch{}
   await rows.deleteOne({_id:context.channelId}).catch(()=>{});throw error;
  }
  return 'This channel is now locked. Members cannot send messages, react, or create threads until `-unlock` or `/unlock` is used.';
 });
}
async function unlockChannel(context){
 await requireAccess(context,'management');await botCheck(context);
 return locked(`channel-lock:${context.channelId}`,async()=>{
  const rows=collection('channel_locks'),record=await rows.findOne({_id:context.channelId});
  if(!record)return 'This channel is not locked by the bot.';
  for(const target of record.saved){
   if(target.had)await context.channel.permissionOverwrites.edit(target.id,restorePayload(target),{type:target.type,reason:`Channel unlocked by ${context.user.id}`});
   else await context.channel.permissionOverwrites.delete(target.id,`Channel unlocked by ${context.user.id}`).catch(error=>{if(error.code!==10009)throw error;});
  }
  await rows.deleteOne({_id:context.channelId});
  return 'This channel has been unlocked and its previous permissions were restored.';
 });
}
module.exports={CONTROLLED,DENIED,snapshot,restorePayload,lockChannel,unlockChannel};
