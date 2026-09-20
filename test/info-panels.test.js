const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const rows=new Map();let failSave=false;
require.cache[require.resolve('../src/store')]={exports:{locked:async(_k,fn)=>fn(),collection:()=>({findOne:async q=>rows.get(q._id),updateOne:async(q,u)=>{if(failSave&&u.$set.messageId){failSave=false;throw Error('database interruption');}rows.set(q._id,{...rows.get(q._id),...u.$set});}})}};
const {specs,payload,syncPanel}=require('../src/info-panels');
test('old-server automatic information panels remain disabled',()=>{
 assert.deepEqual(specs,[]); // Old-server automatic panels remain disabled.
 for(const spec of [{key:"test",sections:["Information"]}]){const p=payload(spec);const box=p.components[0].toJSON();assert.equal(p.flags,D.MessageFlags.IsComponentsV2);assert.equal(box.type,17);assert.deepEqual(p.allowedMentions,{parse:[]});const text=box.components.filter(c=>c.type===10).map(c=>c.content);assert.ok(text.join('').length<=4000);assert.ok(box.components.length<40);}
});
test('panel posting recovers failed database save and subsequent sync does not duplicate',async()=>{
 rows.clear();let sends=0,edits=0;const messages=new D.Collection();
 const channel={permissionsFor:()=>({has:()=>true}),send:async p=>{sends++;const m={id:'m',author:{id:'bot'},components:p.components,edit:async()=>edits++};messages.set(m.id,m);return m;},messages:{fetch:async q=>typeof q==='string'?messages.get(q):messages}};
 const guild={id:'guild',client:{user:{id:'bot'}},channels:{fetch:async()=>channel},members:{fetchMe:async()=>({})}};
 const spec={key:'test',channel:'configured-channel',sections:['Information']};
 failSave=true;await assert.rejects(()=>syncPanel(guild,spec));await syncPanel(guild,spec);await syncPanel(guild,spec);assert.equal(sends,1);assert.equal(edits,1);
});
