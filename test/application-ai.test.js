const test=require('node:test'),assert=require('node:assert/strict');
const {suggest}=require('../src/application-ai');
test('AI advice is real when configured, minimizes identity, and fails transparently',async()=>{
 const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.APPLICATION_AI_MODEL;
 try{
  delete process.env.OPENAI_API_KEY;delete process.env.APPLICATION_AI_MODEL;
  assert.match(await suggest([]),/Unavailable/);
  process.env.OPENAI_API_KEY='test';process.env.APPLICATION_AI_MODEL='test-model';
  const advice=await suggest(['private Roblox ID','None','Roleplay','Teamwork','8','9','Yes','Yes'],async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.ok(!body.input.includes('private Roblox ID'));
   return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Needs clarification: ask about roleplay experience.'}]}]})};
  });assert.match(advice,/Needs clarification/);
  assert.match(await suggest([],async()=>{throw Error('Offline');}),/Unavailable/);
 }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.APPLICATION_AI_MODEL;else process.env.APPLICATION_AI_MODEL=oldModel;}
});
