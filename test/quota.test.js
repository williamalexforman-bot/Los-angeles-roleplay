const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const rows={};let sent=0,failSend=false;const issued=new Set();
function match(r,q){return Object.entries(q).every(([k,v])=>r[k]===v);}
function collection(name){const data=rows[name]||=[];return {
 findOne:async q=>structuredClone(data.find(r=>match(r,q))||null),find:q=>({toArray:async()=>structuredClone(data.filter(r=>match(r,q)))}),
 insertOne:async r=>data.push(structuredClone(r)),
 updateOne:async(q,u,o)=>{let r=data.find(r=>match(r,q));if(!r&&o?.upsert){r={...q,...u.$setOnInsert};data.push(r);}if(r)Object.assign(r,u.$set);}
};}
require.cache[require.resolve('../src/store')]={exports:{collection,locked:async(_k,fn)=>fn()}};
require.cache[require.resolve('../src/discipline')]={exports:{destination:async()=>({send:async p=>{if(failSend)throw Error('offline');assert.equal(p.flags,D.MessageFlags.IsComponentsV2);sent++;return {id:'report'};}}),issueQuotaWarning:async(g,id,r)=>issued.add(`${r.end}:${id}`)}};
const q=require('../src/quota');
test('Saturday 9 AM Eastern handles summer, winter and daylight saving changes',()=>{
 for(const [start,end] of [['2026-09-20T12:00Z','2026-09-26T13:00Z'],['2026-11-01T12:00Z','2026-11-07T14:00Z'],['2026-03-07T14:00Z','2026-03-14T13:00Z']])assert.equal(q.nextSaturday(Date.parse(start)),Date.parse(end));
});
test('weekly totals clip ongoing/boundary sessions and merge duplicate intervals',()=>{
 const shifts=[{userId:'u',started:0,ended:300},{userId:'u',started:200,ended:null},{userId:'u',started:450,ended:700}];
 assert.equal(q.totals(shifts,100,500).get('u'),400);
 assert.equal(q.totals(shifts,500,600).get('u'),100);
});
test('only quota-role humans below two hours are warned; delivery resumes without a second report',async()=>{
 const end=Date.now()-1000,start=end-7*86400000;
 rows.quota=[{_id:'g',enabled:true,start,next:end,zone:'America/New_York'}];
 rows.shifts=[{guildId:'g',userId:'complete',started:end-q.MINIMUM,ended:null}];
 const member=(id,role,bot=false)=>({id,user:{username:id,bot},roles:{cache:new Set(role?[q.QUOTA_ROLE]:[])}});
 const members=[member('missed',true),member('complete',true),member('exempt',false),member('bot',true,true)];
 const guild={id:'g',members:{fetch:async()=>new Map(members.map(m=>[m.id,m]))}};
 failSend=true;await assert.rejects(()=>q.processGuild(guild));assert.equal(issued.size,1);assert.ok(issued.has(`${end}:missed`));
 failSend=false;await q.processGuild(guild);await q.processGuild(guild);
 assert.equal(issued.size,1);assert.equal(sent,1);assert.ok(rows.quota[0].next>end);
 rows.quota[0].enabled=false;rows.quota[0].next=end;await q.processGuild(guild);assert.equal(sent,1);
});

test('scheduled warning IDs remain editable and revocable',()=>{
 const id='quota-1790438400000-1540774157397000202';
 assert.equal(require('../src/infraction-management').caseId('INF-'+id),id);
});
