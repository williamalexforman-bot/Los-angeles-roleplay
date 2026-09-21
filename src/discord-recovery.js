const {performance}=require('node:perf_hooks');
// Keep Discord.js's normal resume path. Replace a failed/destroyed client only
// after the grace period, and never overlap old and new gateway connections.
function discordRecovery({createClient,authenticate=async()=>{},token,log=()=>{},fatal=()=>{},now=()=>performance.now(),offlineMs=120000,retryMs=30000,destroyMs=15000,loginMs=45000}){
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
   log('discord_client_creating');
   client=createClient();const current=client;offlineSince=now();retryAt=Infinity;invalid=false;
   log('discord_client_created');
   log('discord_login_started',{timeoutSeconds:loginMs/1000});
   let loginTimer;
   const loginTimeout=new Promise((_,reject)=>{
    loginTimer=setTimeout(()=>{const error=Error('Discord login timed out');error.name='DiscordLoginTimeout';reject(error);},loginMs);
    loginTimer.unref?.();
   });
   void Promise.race([Promise.resolve().then(()=>authenticate(token)).then(()=>current.login(token)),loginTimeout]).then(()=>{
    if(client===current)log('discord_login_completed');
   }).catch(error=>{
    if(client!==current)return;
    const timedOut=error?.name==='DiscordLoginTimeout';
    retryAt=timedOut?now():now()+retryMs;
    log(timedOut?'discord_login_timeout':'discord_login_failed',{errorType:error?.name||'Error',errorCode:error?.code,retrySeconds:timedOut?0:retryMs/1000});
   }).finally(()=>clearTimeout(loginTimer));
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
