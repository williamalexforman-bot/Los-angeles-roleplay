const {performance}=require('node:perf_hooks');
// Keep Discord.js's normal resume path. Replace a failed/destroyed client only
// after the grace period, and never overlap old and new gateway connections.
function discordRecovery({createClient,token,log=()=>{},fatal=()=>{},now=()=>performance.now(),offlineMs=120000,retryMs=30000,destroyMs=15000}){
 let client,offlineSince=now(),retryAt=Infinity,replacing=false,attempt=0,invalid=false,stopped=false;
 async function replace(reason){
  if(replacing||stopped)return;replacing=true;
  const previous=client;log('discord_recovery',{reason,attempt:++attempt});
  try{
   // Ignore late login failures from the client being retired.
   client=null;
   if(previous){
    let timer;
    try{await Promise.race([previous.destroy(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DestroyTimeout')),destroyMs);})]);}
    finally{clearTimeout(timer);}
   }
   client=createClient();const current=client;offlineSince=now();retryAt=Infinity;invalid=false;
   void Promise.resolve().then(()=>current.login(token)).catch(error=>{
    if(client!==current)return;
    retryAt=now()+retryMs;
    log('discord_login_failed',{errorType:error.name,errorCode:error.code,retrySeconds:retryMs/1000});
   });
  }catch(error){stopped=true;log('discord_recovery_failed',{errorType:error.name});fatal();}
  finally{replacing=false;}
 }
 function tick(){
  if(replacing||stopped)return;
  if(!invalid&&client?.isReady()){offlineSince=null;retryAt=Infinity;return;}
  if(offlineSince===null)offlineSince=now();
  if(now()>=retryAt||now()-offlineSince>=offlineMs)return replace('connection_unavailable');
 }
 function invalidated(source=client){if(source!==client||replacing||stopped||invalid)return;invalid=true;retryAt=now()+retryMs;log('discord_session_invalidated',{retrySeconds:retryMs/1000});}
 return {start:()=>replace('startup'),tick,invalidated,getClient:()=>client};
}
module.exports={discordRecovery};
