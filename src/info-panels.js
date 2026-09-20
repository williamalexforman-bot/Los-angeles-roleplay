const D=require('discord.js');
const {createHash}=require('node:crypto');
const {collection,locked}=require('./store');
const specs=require('./info-panel-content');
const marker=spec=>`Clearwater Fire Department information • ${spec.key}`;
function payload(spec){
 const box=new D.ContainerBuilder().setAccentColor(0x5685EF);
 for(const [n,text] of spec.sections.entries()){
  if(n)box.addSeparatorComponents(new D.SeparatorBuilder());
  box.addTextDisplayComponents(new D.TextDisplayBuilder().setContent(text));
 }
 box.addSeparatorComponents(new D.SeparatorBuilder()).addTextDisplayComponents(new D.TextDisplayBuilder().setContent('-# '+marker(spec)));
 return {flags:D.MessageFlags.IsComponentsV2,components:[box],allowedMentions:{parse:[]}};
}
async function syncPanel(guild,spec){
 return locked(`info:${guild.id}:${spec.key}`,async()=>{
  const rows=collection('info_panels'),key=`${guild.id}:${spec.key}`;
  const version=createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  const channel=await guild.channels.fetch(spec.channel);
  if(!channel?.send)throw new Error('Information panel channel unavailable');
  const me=await guild.members.fetchMe();
  if(!channel.permissionsFor(me)?.has([D.PermissionFlagsBits.ViewChannel,D.PermissionFlagsBits.SendMessages,D.PermissionFlagsBits.ReadMessageHistory]))throw new Error('Information panels need View Channel, Send Messages and Read Message History.');
  let state=await rows.findOne({_id:key}),message;
  if(state?.messageId){
   try{message=await channel.messages.fetch(state.messageId);}catch(e){if(e.code!==10008)throw e;}
   if(message){if(state.version!==version){await message.edit(payload(spec));await rows.updateOne({_id:key},{$set:{version}});}return;}
   state=null;
  }
  if(!state){state={_id:key,started:Date.now(),nonce:createHash('sha256').update(`${key}:${Date.now()}`).digest('hex').slice(0,24)};await rows.updateOne({_id:key},{$set:{...state,messageId:null}},{upsert:true});}
  // Recover a successful Discord send followed by a failed database write.
  const recent=await channel.messages.fetch({limit:100});
  message=recent.find(m=>m.author?.id===guild.client.user.id&&JSON.stringify(m.components).includes(marker(spec)));
  if(!message&&recent.size===100&&Math.min(...recent.map(m=>m.createdTimestamp))>state.started)throw new Error('Panel delivery uncertain; history inspection required before another send.');
  if(!message)message=await channel.send({...payload(spec),nonce:state.nonce,enforceNonce:true});
  else await message.edit(payload(spec));
  await rows.updateOne({_id:key},{$set:{messageId:message.id,version}});
 });
}
async function sync(client){
 if(!client.isReady())return;
 const guild=await client.guilds.fetch(require('./settings').GUILD_ID);
 for(const spec of specs)try{await syncPanel(guild,spec);}catch(e){console.error('Information panel pending:',spec.key,e.code||e.message);}
}
module.exports={payload,syncPanel,sync,specs};
