const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const E=require('../src/panel-emojis'),pack=Object.fromEntries(Object.entries(require('../assets/emojis/pack.json')).map(([n,v])=>[n.replace('valenti_','pcso_'),v]));
test('expanded shift panels remain within V2 limits with all emojis installed',()=>{
 const cache=new D.Collection(Object.keys(pack).map((name,n)=>[String(n),{id:String(1550000000000000000n+BigInt(n)),name,available:true}]));
 E.configure({guilds:{cache:new D.Collection([['g',{emojis:{cache}}]])}});
 for(const p of [require('../src/shifts').shiftPanel()]){
  let count=0,text='';function walk(c){count++;if(c.content)text+=c.content;for(const child of c.components||[])walk(child);}p.components.forEach(c=>walk(c.toJSON()));
  assert.ok(text.length<=4000);assert.ok(count<=40);assert.match(text,/<:pcso_/);assert.ok(p.flags&D.MessageFlags.IsComponentsV2);
 }
 E.configure(null);
});
test('pack has 200 bounded PNG assets with stable names',()=>{assert.equal(Object.keys(pack).length,200);for(const [name,value]of Object.entries(pack)){assert.ok(name.length<=32);assert.match(name,/^[a-z0-9_]+$/);const b=Buffer.from(value,'base64');assert.ok(b.length<256*1024);assert.equal(b.readUInt32BE(16),128);assert.equal(b.readUInt32BE(20),128);}});
