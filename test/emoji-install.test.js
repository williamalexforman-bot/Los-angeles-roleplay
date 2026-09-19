const test=require('node:test'),assert=require('node:assert/strict');
const D=require('discord.js'),{install}=require('../src/emoji-install');
const pack=require('../src/emoji-catalog');
function fixture(admin=true,canCreate=true){
 const emojis=new D.Collection();let count=0;
 const c={user:{id:'user'},guild:{premiumTier:3,id:'guild',members:{fetch:async()=>({permissions:{has:()=>admin}}),fetchMe:async()=>({permissions:{has:()=>canCreate}})},emojis:{fetch:async()=>emojis,create:async({name,attachment})=>{assert.ok(Buffer.isBuffer(attachment));assert.ok(attachment.length<256*1024);const e={id:String(++count),name};emojis.set(e.id,e);return e;}}}};
 return {c,emojis};
}
test('pack contains valid 128px PNGs; installs once and skips duplicates',async()=>{
 for(const [name,data]of Object.entries(pack)){assert.match(name,/^usms_[a-z0-9_]+$/);const b=Buffer.from(data,'base64');assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),128);assert.equal(b.readUInt32BE(20),128);}
 const {c,emojis}=fixture();const summary=await install(c);assert.ok(summary.length<3000);assert.equal(emojis.size,5);assert.match(summary,/28 emojis remaining/);for(let n=0;n<6;n++)await install(c);assert.match(await install(c),/Already installed:\*\* 33/);assert.equal(emojis.size,33);
});
test('permissions are checked and partial failures can resume',async()=>{
 await assert.rejects(install(fixture(false).c),/Administrator/);await assert.rejects(install(fixture(true,false).c),/Create Expressions/);
 const {c}=fixture();const create=c.guild.emojis.create;let n=0;c.guild.emojis.create=async o=>{if(++n===2)throw {code:30008};return create(o);};assert.match(await install(c),/limit reached/);c.guild.emojis.create=create;assert.match(await install(c),/Added:\*\* 5/);
});
test('concurrent installers are rejected and lock is released',async()=>{
 const {c}=fixture();let release,started;const ready=new Promise(r=>started=r);const wait=new Promise(r=>release=r);const p=install(c,async()=>{started();await wait;});await ready;await assert.rejects(install(c),/already running/);release();await p;await install(c);
});
test('prefix aliases and slash registration are available',()=>{
 const {parsePrefix}=require('../src/messages');for(const text of ['-add emojis','-addemojis','-add-emojis'])assert.ok(parsePrefix(text));
 const c=require('../src/commands/config').commands.find(c=>c.name==='add-emojis').toJSON();assert.equal(c.default_member_permissions,String(D.PermissionFlagsBits.Administrator));
});
