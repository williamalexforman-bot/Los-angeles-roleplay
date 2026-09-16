const {randomUUID}=require('node:crypto');
const {collection,locked}=require('./store');
const SELF_ID='1066264414359138304';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const jobs=()=>collection('dm_tests');
function parse(text){
 const match=/^([\s\S]+)\s+(\d+)$/.exec(text.trim());
 if(!match||!match[1].trim()||match[1].length>1800||Number(match[2])<1||Number(match[2])>50)throw new Error('Use -spamcool your message 1–50 (message up to 1,800 characters), or -spamcool stop.');
 return {text:match[1].trim(),count:Number(match[2])};
}
async function runBatch(user,job,wait=pause){
 if(user.id!==SELF_ID||job._id!==SELF_ID||!Number.isInteger(job.count)||job.count<1||job.count>50)throw new Error('Self-DM restriction violated.');
 try {
  for(let n=0;n<job.count;n++){
   const state=await jobs().findOne({_id:SELF_ID});
   if(state?.runId!==job.runId||state.status!=='running')return;
   await user.send({content:job.text,allowedMentions:{parse:[]}});
   await jobs().updateOne({_id:SELF_ID,runId:job.runId},{$set:{sent:n+1}});
   if(n+1<job.count)await wait(2000);
  }
  await jobs().updateOne({_id:SELF_ID,runId:job.runId,status:'running'},{$set:{status:'completed'}});
 }catch(e){
  console.error('Self-DM test stopped:',e.code||e.name);
  await jobs().updateOne({_id:SELF_ID,runId:job.runId,status:'running'},{$set:{status:'failed'}}).catch(()=>{});
 }
}
async function request(user,input){
 if(user.id!==SELF_ID)throw new Error('Only account 1066264414359138304 can use this self-DM command.');
 if(input.trim().toLowerCase()==='stop'){
  await jobs().updateOne({_id:SELF_ID,status:'running'},{$set:{status:'cancelled'}});return 'Stopped your DM test. A message already being sent may still arrive.';
 }
 const args=parse(input);
 const job=await locked(`self-dm:${SELF_ID}`,async()=>{
  const previous=await jobs().findOne({_id:SELF_ID});
  if(previous?.nextAllowed>Date.now())throw new Error('Please wait 10 minutes between DM tests. You can still use -spamcool stop.');
  const next={_id:SELF_ID,...args,runId:randomUUID(),status:'running',sent:0,nextAllowed:Date.now()+600000};
  await jobs().replaceOne({_id:SELF_ID},next,{upsert:true});return next;
 });
 void runBatch(user,job).catch(e=>console.error('Self-DM test failed:',e.code||e.name));
 return `Sending up to ${job.count} messages to your own DMs, two seconds apart. Use -spamcool stop to cancel. This is not a hosting keep-alive.`;
}
async function handle(message){
 if(message.author.bot||message.webhookId)return;
 try{
  const result=await request(message.author,message.content.replace(/^-spamcool\s*/i,''));
  await message.reply({content:result,allowedMentions:{parse:[],repliedUser:false}});
  if(message.guild)await message.delete().catch(()=>{});
 }catch(e){await message.reply({content:e.name==='Error'?e.message:'DM test could not start. Check the bot logs.',allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});}
}
module.exports={SELF_ID,parse,runBatch,request,handle};
