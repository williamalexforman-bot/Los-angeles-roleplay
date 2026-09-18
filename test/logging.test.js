const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js'),{EventEmitter}=require('node:events');
const store=require('../src/store');let rows=new Map(),offline=false;
store.locked=async(_key,work)=>work();
store.collection=()=>{if(offline)throw Error('Offline');return {insertOne:async r=>{if(rows.has(r._id))throw {code:11000};rows.set(r._id,structuredClone(r));},findOne:async q=>rows.get(q._id),updateOne:async(q,u)=>Object.assign(rows.get(q._id),u.$set),find:()=>({sort:()=>({limit:()=>({toArray:async()=>[...rows.values()].filter(r=>!r.delivered&&r.nextAttempt<=Date.now())})})})};};
require('../src/discipline').settings=async()=>Object.fromEntries(['messages','roles','claims'].map(k=>['log_'+k,k]));
const L=require('../src/logging');
const tick=()=>new Promise(r=>setImmediate(r));
test('old log destinations are disabled until configured',()=>{
 assert.equal(Object.keys(L.CHANNELS).length,8);assert.ok(Object.values(L.CHANNELS).every(v=>v===null));
});
test('queue deduplicates, recovers startup outages, and suppresses mentions',async()=>{
 rows=new Map();offline=true;await L.record('messages','guild','Message Edited','@everyone','message:1');offline=false;
 let sent=0;const client={guilds:{fetch:async()=>({channels:{fetch:async id=>{assert.equal(id,'messages');return {send:async p=>{sent++;assert.ok(p.flags&D.MessageFlags.IsComponentsV2);assert.deepEqual(p.allowedMentions,{parse:[]});}};}}})}};
 await L.flushLogs(client);assert.equal(sent,1);
 await L.record('messages','guild','Message Edited','@everyone','message:1');await L.flushLogs(client);assert.equal(sent,1);assert.ok([...rows.values()][0].expires instanceof Date);
});
test('failed log channel backs off while other logs deliver',async()=>{
 rows=new Map();await L.record('roles','guild','Role Updated','details','r1');await L.record('claims','guild','Ticket Claimed','details','c1');
 await L.flushLogs({guilds:{fetch:async()=>({channels:{fetch:async id=>{if(id==='roles')throw {code:50013};return {send:async()=>{}};}}})}});
 assert.equal([...rows.values()].find(r=>r.kind==='claims').delivered,true);assert.ok([...rows.values()].find(r=>r.kind==='roles').nextAttempt>Date.now());
});
test('events log edits and unknown deletes but not newly sent messages',async()=>{
 rows=new Map();const client=new EventEmitter();L.registerLogs(client);const guild={id:process.env.GUILD_ID||'guild'};
 const message={guild,channelId:'chat',id:'m1',author:{id:'person',bot:false},content:'hello',url:'https://discord.com/channels/g/c/m',attachments:new Map()};
 client.emit('messageCreate',message);client.emit('messageCreate',{...message,id:'bot',author:{bot:true}});client.emit('messageCreate',{...message,id:'dm',guild:null});client.emit('messageCreate',{...message,id:'log',channelId:L.CHANNELS.messages});
 client.emit('messageUpdate',message,{...message,content:'edited',editedTimestamp:1});client.emit('messageDelete',{...message,id:'old',author:null,content:null});await tick();
 assert.equal(rows.size,2);assert.ok([...rows.values()].some(r=>r.body.includes('Unavailable')));
 assert.ok(![...rows.values()].some(r=>r.title==='Message Sent'));
 client.emit('messageDeleteBulk',new Map([['bulk',{...message,id:'bulk'}]]));await tick();assert.ok([...rows.values()].some(r=>r.title==='Message Deleted (Bulk)'));
 client.emit('messageCreate',{...message,id:'threat',content:'going to raid your server'});await tick();assert.ok([...rows.values()].some(r=>r.kind==='raids'));
 client.emit('guildAuditLogEntryCreate',{action:D.AuditLogEvent.MemberKick,id:'audit1',targetId:'person',executorId:'staff',reason:'Reason'},guild);await tick();assert.ok([...rows.values()].some(r=>r.title==='Member Kicked'));
});
test('queued legacy Message Sent logs are suppressed without sending',async()=>{
 rows=new Map();await L.record('messages','guild','Message Sent','old message','old-sent');
 await L.flushLogs({guilds:{fetch:async()=>{throw Error('Must not fetch a destination');}}});
 const row=[...rows.values()][0];assert.equal(row.delivered,true);assert.equal(row.suppressed,true);
});
test('raid alerts are threshold based with cooldown and limited keyword matching',()=>{
 const state=new Map(),now=1000000;for(let n=0;n<9;n++)assert.equal(L.trackRaid(state,'guild',String(n),now),0);
 assert.equal(L.trackRaid(state,'guild','9',now),10);assert.equal(L.trackRaid(state,'guild','10',now+1),0);
 assert.equal(L.isThreat('we are going to raid your server'),true);assert.equal(L.isThreat('What is a raid?'),false);
});
