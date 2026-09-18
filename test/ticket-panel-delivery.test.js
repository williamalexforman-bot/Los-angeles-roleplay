const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const {deliver}=require('../src/ticket-panel-delivery');
const record={_id:'123456789012345678',owner:'owner',type:'general',reason:'Help'};
test('invalid custom emoji falls back to functional V2 text buttons',async()=>{
 let attempts=0;
 const result=await deliver({send:async p=>{
  attempts++;
  if(attempts===1)throw {code:50035,rawError:{errors:{components:{emoji:{_errors:[{message:'Invalid emoji'}]}}}}};
  assert.ok(p.flags&D.MessageFlags.IsComponentsV2);
  const controls=p.components[0].components.filter(c=>(c.type ?? c.data?.type)===1).at(-1).components;
  assert.equal(controls.length,3);assert.equal(controls[0].custom_id,'ticket:claim');assert.ok(controls.every(c=>!c.emoji));
  return {id:'panel'};
 }},record);
 assert.equal(attempts,2);assert.equal(result.emojiFallback,true);
});
test('temporary send failures retry using the same nonce',async()=>{
 let attempts=0;const nonces=[];
 await deliver({send:async p=>{nonces.push(p.nonce);if(++attempts===1)throw {status:503};return {id:'panel'};}},record);
 assert.equal(attempts,2);assert.deepEqual(nonces,[record._id,record._id]);
});
test('missing permissions do not cause repeated sends',async()=>{
 let attempts=0;await assert.rejects(deliver({send:async()=>{attempts++;throw {code:50013};}},record));assert.equal(attempts,1);
});
test('new panels ping opener and support while edits stay silent',async()=>{
 await deliver({send:async p=>{assert.deepEqual(p.allowedMentions,{parse:[],users:['owner'],roles:[]});return {id:'panel'};}},record);
 await deliver({},record,{edit:async p=>{assert.deepEqual(p.allowedMentions,{parse:[]});return {id:'panel'};}});
});
