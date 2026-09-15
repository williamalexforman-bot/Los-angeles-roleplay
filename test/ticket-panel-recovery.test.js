const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');store.locked=async(_key,work)=>work();
let updates=[];store.collection=()=>({updateOne:async(...args)=>updates.push(args)});
const {ensureOpeningPanel}=require('../src/tickets');
const record={_id:'123456789012345678',owner:'owner',type:'general',reason:'Need help'};
test('missing opening panel is restored as V2 with controls',async()=>{
 let payload;updates=[];
 const channel={client:{user:{id:'bot'}},messages:{fetch:async()=>new D.Collection()},send:async p=>{payload=p;return {id:'new'};}};
 await ensureOpeningPanel(channel,record);
 assert.ok(payload.flags&D.MessageFlags.IsComponentsV2);const json=JSON.stringify(payload.components[0].toJSON());
 for(const value of ['ticket:claim','ticket:close','ticket:escalate','Need help'])assert.ok(json.includes(value));
 assert.equal(payload.enforceNonce,true);assert.equal(updates[0][1].$set.panelPending,false);
});
test('existing opening panel is adopted rather than duplicated',async()=>{
 let edits=0;
 const message={id:'existing',author:{id:'bot'},components:[{toJSON:()=>({custom_id:'ticket:close'})}],edit:async()=>{edits++;}};
 const channel={client:{user:{id:'bot'}},messages:{fetch:async()=>new D.Collection([['existing',message]])},send:async()=>{throw Error('Duplicate panel');}};
 await ensureOpeningPanel(channel,record);assert.equal(edits,1);
});
test('read failures do not send duplicate panels',async()=>{
 let sent=false;const channel={messages:{fetch:async()=>{throw Object.assign(Error('Unavailable'),{code:50013});}},send:async()=>{sent=true;}};
 await assert.rejects(ensureOpeningPanel(channel,{...record,panelId:'old'}));assert.equal(sent,false);
});
