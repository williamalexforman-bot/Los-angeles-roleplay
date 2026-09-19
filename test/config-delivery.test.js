const test=require('node:test'),assert=require('node:assert/strict');
const D=require('discord.js'),{panel}=require('../src/panels');
const {sendPanel,describeError,errorFields}=require('../src/config-delivery');
function fixture(){const guild={id:'g',members:{fetchMe:async()=>({})}};const channel={id:'c',guildId:'g',isTextBased:()=>true,permissionsFor:()=>({has:()=>true})};return {guild,channel};}
test('invalid emoji retry strips dropdown and button emojis and keeps V2 controls',async()=>{
 const {guild,channel}=fixture();let count=0;channel.send=async p=>{if(++count===1)throw {code:50035,rawError:{errors:{components:{_errors:[{message:'Invalid emoji'}]}}}};assert.ok(p.flags&D.MessageFlags.IsComponentsV2);const menu=p.components[0].components.find(c=>c.type===1).components[0];assert.equal(menu.custom_id,'ticket:create');assert.equal(menu.options.length,5);assert.ok(menu.options.every(o=>!o.emoji));return 'sent';};assert.equal(await sendPanel(channel,guild,panel('ticket')),'sent');assert.equal(count,2);
});
test('permission errors are specific, no send or retry when denied',async()=>{const {guild,channel}=fixture();channel.permissionsFor=()=>({has:()=>false});channel.send=async()=>assert.fail();await assert.rejects(sendPanel(channel,guild,panel('ticket')),/View Channel, Send Messages, Embed Links/);});
test('non-emoji failure is never retried and field logs omit request contents',async()=>{const {guild,channel}=fixture();let count=0;channel.send=async()=>{count++;throw {code:50013};};await assert.rejects(sendPanel(channel,guild,panel('ticket')));assert.equal(count,1);assert.match(describeError({code:50013}),/50013/);assert.deepEqual(errorFields({rawError:{errors:{components:{0:{_errors:[{message:'private value'}]}}}}}),['components.0']);});
test('config acknowledges before slow member fetch and still enforces admin',async()=>{
 const calls=[];const i={deferReply:async()=>calls.push('defer'),guild:{members:{fetch:async()=>{calls.push('fetch');return {permissions:{has:()=>false}};}}},user:{id:'u'}};
 await assert.rejects(require('../src/interactions').config(i),/Administrator/);assert.deepEqual(calls,['defer','fetch']);
});
