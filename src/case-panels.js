const {collection,locked}=require('./store');
const {caseNotice,NOTICE_VERSION}=require('./legacy-layout');
async function syncCasePanels(client){
 const cases=await collection('cases').find({status:'logged',noticeVersion:{$ne:NOTICE_VERSION},messageId:{$exists:true}}).limit(50).toArray();
 for(const item of cases){try{await locked(`member:${item.guildId}:${item.userId}`,async()=>{
  const fresh=await collection('cases').findOne({_id:item._id});if(!fresh||fresh.noticeVersion===NOTICE_VERSION)return;
  const guild=await client.guilds.fetch(fresh.guildId),channel=await guild.channels.fetch(fresh.logChannel);
  const message=await channel.messages.fetch(fresh.messageId).catch(e=>{if(e.code===10008)return null;throw e;});
  if(message)await message.edit({...caseNotice(fresh),content:null,embeds:[]});
  await collection('cases').updateOne({_id:fresh._id},{$set:{noticeVersion:NOTICE_VERSION}});
 });}catch(e){console.error('V2 case update pending:',item._id,e.code||e.name);}}
}
module.exports={syncCasePanels};
