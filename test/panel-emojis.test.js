const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const E=require('../src/panel-emojis'),pack=Object.fromEntries(Object.entries(require('../assets/emojis/pack.json')).map(([n,v])=>[n.replace('valenti_','pcso_'),v]));
const {v2,panel,button}=require('../src/panels');
const {caseNotice}=require('../src/legacy-layout');
test('all pack names resolve in configured guild and replaced IDs are picked up',()=>{
 const cache=new D.Collection(Object.keys(pack).map((name,n)=>[String(n),{id:String(100+n),name,available:true}]));
 E.configure({guilds:{cache:new D.Collection([['g',{emojis:{cache}}]])}});
 for(const name of Object.keys(pack)){const short=name.slice(5);assert.ok(E.icon(short).includes(name));assert.equal(E.key(short),short);}
 const e=cache.find(e=>e.name==='pcso_promotion');e.id='999';assert.match(E.icon('promotion'),/:999>/);
 assert.equal(E.icon('promotion','fallback','other'),'fallback');
 cache.delete(cache.findKey(e=>e.name==='pcso_promotion'));assert.equal(E.icon('promotion','fallback'),'fallback');
 E.configure(null);
});
test('V2 titles, case fields and controls use custom emojis without touching user text',()=>{
 const cache=new D.Collection(Object.keys(pack).map((name,n)=>[String(n),{id:String(100+n),name,available:true}]));E.configure({guilds:{cache:new D.Collection([['g',{emojis:{cache}}]])}});
 for(const title of ['Staff Promotion','Infraction Issued','Active Deployment','Shift Started','Application Accepted','Message Log']){const p=v2(title,'User typed: warning promotion');const json=p.components[0].toJSON();assert.ok(json.components.some(c=>c.content?.includes('<:pcso_')));assert.ok(json.components.some(c=>c.content==='User typed: warning promotion'));}
 assert.ok(button('x','Claim').toJSON().emoji.id);
 assert.match(JSON.stringify(panel('ticket').components[0].toJSON()),/Clearwater Fire Department Support Center/);
 const p=caseNotice({_id:'case',kind:'infraction',type:'Warning',created:Date.now(),reason:'user text',userId:'1',actorId:'2',guildId:'g',next:{warnings:1}});assert.match(JSON.stringify(p.components[0].toJSON()),/pcso_infraction/);
 E.configure(null);
});
