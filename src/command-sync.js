const API='https://discord.com/api/v10';
async function request(token,path,method='GET',body){
 const response=await fetch(API+path,{method,headers:{Authorization:`Bot ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 let data=null;const text=await response.text();if(text)try{data=JSON.parse(text);}catch{data=text.slice(0,300);}
 if(!response.ok){
  const retry=Number(data?.retry_after||response.headers.get('retry-after')||0);
  const error=new Error(response.status===429?`Discord rate limited command sync${retry?`; retry after approximately ${Math.ceil(retry)} seconds`:''}. Existing commands were preserved and sync will retry automatically.`:`Discord command API returned ${response.status}: ${data?.message||'Unknown error'}`);
  error.code=data?.code||`HTTP_${response.status}`;error.status=response.status;error.retryAfter=retry;throw error;
 }
 return data;
}
async function sync(token,applicationId,guildId,commands){
 const base=`/applications/${applicationId}/guilds/${guildId}/commands`,existing=await request(token,base),byName=new Map(existing.map(c=>[c.name,c])),results=[];
 // Edit commands in place. This avoids consuming Discord's daily guild-command
 // creation allowance on every Render restart.
 for(const command of commands){
  const current=byName.get(command.name);
  const saved=current?await request(token,`${base}/${current.id}`,'PATCH',command):await request(token,base,'POST',command);
  results.push(saved);byName.delete(command.name);
 }
 for(const obsolete of byName.values())await request(token,`${base}/${obsolete.id}`,'DELETE');
 return results;
}
module.exports={request,sync};
