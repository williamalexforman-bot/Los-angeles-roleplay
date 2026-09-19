const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');const records=['infraction','promotion'].map((kind,i)=>({_id:String(i),guildId:'guild',userId:'user',kind,type:'Warning',messageId:String(i),logChannel:'channel',status:'logged',created:Date.now()}));
store.locked=async(_key,work)=>work();store.collection=()=>({find:()=>({limit:()=>({toArray:async()=>records})}),findOne:async q=>records.find(r=>r._id===q._id),updateOne:async(q,u)=>Object.assign(records.find(r=>r._id===q._id),u.$set)});
const {syncCasePanels}=require('../src/case-panels');
test('saved infraction and promotion messages migrate by clearing legacy embeds',async()=>{
 let edits=0;
 const client={guilds:{fetch:async()=>({channels:{fetch:async()=>({messages:{fetch:async()=>({edit:async p=>{edits++;assert.equal(p.content,null);assert.deepEqual(p.embeds,[]);assert.ok(p.flags&D.MessageFlags.IsComponentsV2);assert.equal(p.components[0].toJSON().type,17);}})}})}})}};
 await syncCasePanels(client);assert.equal(edits,2);assert.ok(records.every(r=>r.noticeVersion===9));
});
