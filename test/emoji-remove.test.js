const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const {remove,install}=require('../src/emoji-install');
function fixture(){
 const removed=[],emojis=new D.Collection();
 for(const [id,name,author,managed]of [['1','pcso_ticket','bot',false],['2','pcso_promotion','human',false],['3','pcso_infraction',null,false],['4','unrelated','bot',false],['5','pcso_claim','bot',true]])emojis.set(id,{id,name,author:author?{id:author}:null,managed,delete:async()=>{removed.push(id);emojis.delete(id);}});
 const c={user:{id:'admin'},guild:{id:'server',members:{fetch:async()=>({permissions:{has:()=>true}}),fetchMe:async()=>({id:'bot',permissions:{has:()=>true}})},emojis:{fetch:async()=>emojis}}};return {c,removed,emojis};
}
test('removes only bot-created pack names; repeat is harmless',async()=>{const {c,removed}=fixture();assert.match(await remove(c),/Deleted:\*\* 1/);assert.deepEqual(removed,['1']);assert.match(await remove(c),/Deleted:\*\* 0/);});
test('denies non-administrators without deleting',async()=>{const {c,removed}=fixture();c.guild.members.fetch=async()=>({permissions:{has:()=>false}});await assert.rejects(remove(c),/Administrator/);assert.deepEqual(removed,[]);});
test('permission failures are reported and release lock for a retry',async()=>{const {c,emojis}=fixture();emojis.get('1').delete=async()=>{throw {code:50013};};assert.match(await remove(c),/denied permission/);emojis.get('1').delete=async()=>{};assert.match(await remove(c),/Deleted:\*\* 1/);});
test('delete locks out concurrent install',async()=>{const {c}=fixture();let release,start;const ready=new Promise(r=>start=r);const wait=new Promise(r=>release=r);const p=remove(c,async()=>{start();await wait;});await ready;await assert.rejects(install(c),/already running/);release();await p;});
test('all delete prefix aliases parse',()=>{const {parsePrefix}=require('../src/messages');for(const s of ['-delete emojis','-deleteemojis','-delete-emojis'])assert.ok(parsePrefix(s));assert.equal(parsePrefix('-delete all'),null);});
