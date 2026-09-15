const test=require('node:test'),assert=require('node:assert/strict');
const D=require('discord.js');
const data={};
function match(r,q){return Object.entries(q).every(([k,v])=>v&&typeof v==='object'&&'$ne'in v?r[k]!==v.$ne:r[k]===v);}
function collection(name){const rows=data[name]||=[];return {
 findOne:async q=>structuredClone(rows.find(r=>match(r,q))||null),
 find:q=>({toArray:async()=>structuredClone(rows.filter(r=>match(r,q)))}),
 insertOne:async r=>rows.push(structuredClone(r)),
 updateOne:async(q,u,o)=>{let r=rows.find(r=>match(r,q));if(!r&&o?.upsert){r={...q,...u.$setOnInsert};rows.push(r);}if(r)Object.assign(r,u.$set||{});},
};}
require.cache[require.resolve('../src/store')]={exports:{collection,locked:async(k,fn)=>fn()}};
let sent=0,fail=false;
require.cache[require.resolve('../src/discipline')]={exports:{destination:async()=>({send:async p=>{if(fail)throw Error('offline');sent++;p.components[0].toJSON();return {id:'msg'};}})}};
const {processGuild,quotaCommand}=require('../src/quota');
const {MANAGER}=require('../src/access');
const deadline=Date.parse('2026-09-18T14:00:00Z');
const guild={id:'g',members:{fetch:async arg=>arg?{roles:{cache:new Set([MANAGER])}}:new D.Collection(['done','missed'].map(id=>[id,{id,user:{username:id,bot:false},joinedTimestamp:1}]))}};
test('missed-deadline recovery saves one complete report and retries delivery',async()=>{
 const old=Date.now;Date.now=()=>deadline+1000;
 try {
 data.quota=[{_id:'g',enabled:true,zone:'America/New_York',start:deadline-7*86400000,next:deadline}];
 data.shifts=[{guildId:'g',userId:'done',started:deadline-1800000,ended:deadline}];
 fail=true;await assert.rejects(()=>processGuild(guild));assert.equal(data.quota_reports.length,1);assert.equal(sent,0);
 fail=false;await processGuild(guild);await processGuild(guild);assert.equal(sent,1);assert.deepEqual(data.quota_reports[0].missed.map(m=>m.id),['missed']);
 }finally{Date.now=old;}
});
test('disabled quota skips reporting; enabling starts fresh without catch-up',async()=>{
 const old=Date.now;Date.now=()=>deadline+1000;
 try {
 data.quota=[{_id:'g',enabled:false,zone:'America/New_York',start:deadline-7*86400000,next:deadline}];
 const count=sent;await processGuild(guild);assert.equal(sent,count);
 await quotaCommand({guildId:'g',guild,user:{id:'manager'},options:{getSubcommand:()=> 'enable'},deferReply:async()=>{},editReply:async()=>{}});
 assert.equal(data.quota[0].start,Date.now());assert.ok(data.quota[0].next>Date.now());await processGuild(guild);assert.equal(sent,count);
 }finally{Date.now=old;}
});
