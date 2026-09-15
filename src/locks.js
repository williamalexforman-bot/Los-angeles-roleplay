const {randomUUID}=require('node:crypto');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withLock(locks,key,work,{waitMs=20000,retryMs=250,leaseMs=120000}={}){
 const owner=randomUUID(),deadline=Date.now()+waitMs;
 for(;;){
  try{
   const lock=await locks.findOneAndUpdate({_id:key,expires:{$lte:new Date()}},{$set:{owner,expires:new Date(Date.now()+leaseMs)}},{upsert:true,returnDocument:'after'});
   if(lock?.owner===owner)break;
  }catch(e){if(e.code!==11000)throw e;}
  if(Date.now()>=deadline)throw new Error(key.startsWith('ticket')?'Your ticket is still being processed. Wait a moment, then try again; do not submit repeatedly.':'An earlier action is still being processed. Please wait a moment before trying again.');
  await delay(retryMs);
 }
 const timer=setInterval(()=>{locks.updateOne({_id:key,owner},{$set:{expires:new Date(Date.now()+leaseMs)}}).catch(e=>console.error('Lock renewal failed:',e.code||e.name));},Math.max(1000,Math.floor(leaseMs/4)));
 try{return await work();}finally{clearInterval(timer);await locks.deleteOne({_id:key,owner}).catch(e=>console.error('Lock cleanup pending:',e.code||e.name));}
}
module.exports={withLock};
