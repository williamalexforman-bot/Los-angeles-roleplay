const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('discord.js');
const rows={};
function match(r,q){return Object.entries(q).every(([k,v])=>k==='$or'?v.some(x=>match(r,x)):v&&typeof v==='object'&&'$ne'in v?r[k]!==v.$ne:r[k]===v);}
function col(name){const data=rows[name]||=[];return {
findOne:async q=>structuredClone(data.find(r=>match(r,q))||null),
find:q=>({toArray:async()=>structuredClone(data.filter(r=>match(r,q)))}),
insertOne:async r=>data.push(structuredClone(r)),
updateOne:async(q,u,opts)=>{let r=data.find(r=>match(r,q));if(!r&&opts?.upsert){r={...q};data.push(r);}if(r)Object.assign(r,structuredClone(u.$set||u.$setOnInsert||{}));},
};}
const locks=new Map();
async function locked(key,fn){if(locks.has(key))throw Error('locked');locks.set(key,true);try{return await fn();}finally{locks.delete(key);}}
require.cache[require.resolve('../src/store')]={exports:{collection:col,locked}};
let staff=true,admin=false;
const messages=new Map();let sent=0;
const logs=[];
const activeChannel={id:'active',send:async p=>{const id=String(++sent);messages.set(id,p);return {id};},messages:{fetch:async id=>{if(!messages.has(id))throw {code:10008};return {edit:async p=>messages.set(id,p)};},delete:async id=>messages.delete(id)}};
require.cache[require.resolve('../src/discipline')]={exports:{settings:async()=>({shiftRole:'staff',shiftLogs:'logs',activeShifts:'active'}),destination:async(g,key)=>key==='shiftLogs'?{send:async p=>logs.push(p)}:activeChannel}};
const {ROLES}=require('../src/settings');
let subjectRoles=new Set();
const guild={id:'guild',members:{fetch:async()=>({permissions:{has:()=>admin},roles:{cache:{has:id=>id==='staff'?staff:subjectRoles.has(id)}}})}};
const client={guilds:{cache:new Map([['guild',guild]])}};
let shifts=require('../src/shifts');
function interaction(id='event'){return {id,guildId:'guild',guild,user:{id:'user'}};}
function reset(){for(const k of Object.keys(rows))delete rows[k];logs.length=0;messages.clear();sent=0;staff=true;admin=false;subjectRoles=new Set();}
test('staff shifts persist, reject duplicate starts and close exactly once',async()=>{
reset();await shifts.changeShift(interaction('start'),'start');
await shifts.changeShift(interaction('start2'),'start');assert.equal(rows.shifts.length,1);
rows.shifts[0].started-=3600000;
delete require.cache[require.resolve('../src/shifts')];shifts=require('../src/shifts');
assert.match(await shifts.changeShift(interaction(),'status'),/1h 0m/);
await shifts.changeShift(interaction('end'),'end');const original=rows.shifts[0].ended;
await shifts.changeShift(interaction('end2'),'end');assert.equal(rows.shifts[0].ended,original);assert.ok(rows.shifts[0].duration>=3600000);
assert.equal(logs.length,0);assert.equal(messages.size,0);
});
test('all members can shift; suspended members cannot start',async()=>{
reset();staff=false;await shifts.changeShift(interaction(),'start'); await shifts.changeShift(interaction(),'end');
staff=true;subjectRoles.add(ROLES.suspended);await assert.rejects(()=>shifts.changeShift(interaction(),'start'),/suspended/);
subjectRoles.clear();await shifts.changeShift(interaction(),'start');staff=false;
assert.match(await shifts.changeShift(interaction(),'end'),/Shift ended/);
});
test('shift launcher is V2 and describes two-hour quota',()=>{
 const p=shifts.shiftPanel();assert.equal(p.flags,D.MessageFlags.IsComponentsV2);
 assert.match(JSON.stringify(p.components[0].toJSON()),/2 hours/);
});
test('view another member reports role-scoped quota without channel access',async()=>{
 reset();subjectRoles.add('1540774157397000202');
 const text=await shifts.viewShift(interaction(),'other');assert.match(text,/<@other>/);assert.match(text,/2h 0m/);
 subjectRoles.clear();assert.match(await shifts.viewShift(interaction(),'other'),/Not required/);
 assert.equal(logs.length,0);
});
