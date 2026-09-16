const {ticketNotice}=require('./legacy-layout');
const {TICKET_ACCESS_ROLE}=require('./settings');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function emojiFailure(e){return e.code===10014 || (e.code===50035 && /emoji/i.test(JSON.stringify(e.rawError?.errors || e.errors || e.message || '')));}
function withoutButtonEmojis(payload){
 const components=payload.components.map(c=>c.toJSON());
 function walk(c){if(c.type===2)delete c.emoji;for(const child of c.components||[])walk(child);}
 components.forEach(walk);return {...payload,components};
}
async function deliver(channel,record,message){
 let payload=ticketNotice(record),fallback=false;
 for(let attempt=0;;attempt++){
  try {
   const sent=message?await message.edit(payload):await channel.send({...payload,nonce:record._id,enforceNonce:true,allowedMentions:{parse:[],users:[record.owner],roles:[TICKET_ACCESS_ROLE]}});
   return {message:sent||message,emojiFallback:fallback};
  }catch(e){
   if(!fallback&&emojiFailure(e)){payload=withoutButtonEmojis(payload);fallback=true;continue;}
   const transient=e.status>=500 || ['ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(e.code);
   if(!transient||attempt>=2)throw e;
   await pause(250*(attempt+1));
  }
 }
}
module.exports={deliver,emojiFailure};
