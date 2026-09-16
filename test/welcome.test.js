const test=require('node:test'),assert=require('node:assert/strict');
const discipline=require('../src/discipline');
let configured=null;
discipline.settings=async()=>({welcome:configured});
const {welcome,TEXT}=require('../src/welcome');
test('welcome uses configured channel or system channel and only mentions new member',async()=>{
 for(const id of [null,'chosen']) {
  configured=id;let payload;
  await welcome({id:'newmember',guild:{id:'guild',systemChannelId:'system',channels:{fetch:async channel=>{assert.equal(channel,id||'system');return {isTextBased:()=>true,send:async p=>{payload=p;}};}}}});
  assert.equal(payload.content, `${TEXT}\n<@newmember>`);
  assert.equal(payload.components,undefined);
  assert.equal(payload.embeds,undefined);
  assert.deepEqual(payload.allowedMentions,{parse:[],users:['newmember']});
 }
});
