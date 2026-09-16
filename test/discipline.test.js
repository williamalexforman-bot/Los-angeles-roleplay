const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('discord.js');
const { ROLES } = require('../src/settings');
const { panel } = require('../src/panels');
const data = {};
function matches(doc, query) {
  return Object.entries(query).every(([k,v]) => {
    const actual=k.split('.').reduce((a,b)=>a?.[b],doc);
    if (v && typeof v==='object') {
      if ('$in' in v) return v.$in.includes(actual);
      if ('$lte' in v) return actual <= v.$lte;
    }
    return actual===v;
  });
}
function collection(name) {
  const rows=data[name] ||= [];
  return {
    findOne: async q => structuredClone(rows.find(r=>matches(r,q)) || null),
    find: q => ({toArray:async()=>structuredClone(rows.filter(r=>matches(r,q)))}),
    insertOne: async r => { rows.push(structuredClone(r)); },
    replaceOne: async(q,r) => { const n=rows.findIndex(r=>matches(r,q)); if(n<0) rows.push(structuredClone(r)); else rows[n]=structuredClone(r); },
    updateOne: async(q,u) => { const r=rows.find(r=>matches(r,q)); if(!r) return; Object.assign(r, structuredClone(u.$set || {})); for(const k of Object.keys(u.$unset || {})) delete r[k]; },
  };
}
require.cache[require.resolve('../src/store')]={exports:{collection,locked:async(k,fn)=>fn()}};
const {advance,endDate,issue,recover}=require('../src/discipline');
function setup(state={}) {
  for(const key of Object.keys(data)) delete data[key];
  const roleIds=['rank','1538401039684866143',...ROLES.warnings,...ROLES.strikes,ROLES.suspended];
  const roles = new D.Collection(roleIds.map(id=>[id,{id,managed:false}]));
  const cache = new D.Collection(['rank',ROLES.retained,ROLES.strikes[1]].map(id=>[id,roles.get(id)]));
  const log = [];
  const target = { id:'member',user:{bot:false},manageable:true,roles:{cache,
    add:async id=>{assert.equal(data.cases?.[0]?.status,'prepared');cache.set(id,roles.get(id));},
    remove:async id=>{assert.ok(data.cases?.length);cache.delete(id);},
  }};
  const actor={id:'owner',permissions:{has:()=>true},roles:{cache:new Set(['1538395177448644709']),highest:{comparePositionTo:()=>1}}};
  const me={permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}};
  const channel={id:'log',isTextBased:()=>true,permissionsFor:()=>({has:()=>true}),send:async p=>log.push(p)};
  const guild={id:'guild',ownerId:'owner',roles:{cache:roles,fetch:async()=>roles},channels:{fetch:async()=>channel},members:{me,fetchMe:async()=>me,fetch:async o=>o.user==='owner'?actor:target}};
  data.members=[{_id:'guild:member',guildId:'guild',userId:'member',warnings:0,strikes:2,total:2,...state}];
  const i={id:'case',guildId:'guild',guild,user:{id:'owner'}};
  return {i,target,log,guild};
}
test('warning escalation resets warning tier and adds exactly one strike',()=>{
  assert.deepEqual(advance({warnings:2,strikes:1},'Warning'),{warnings:0,strikes:2,suspend:false});
  assert.deepEqual(advance({warnings:2,strikes:2},'Warning'),{warnings:0,strikes:3,suspend:true});
  assert.equal(advance({},'Suspension').suspend,true);
});
test('invalid or past suspension dates are rejected',()=>{
  for(const date of ['', '2026-02-30 12:00','2001-01-01 12:00','tomorrow']) assert.throws(()=>endDate(date));
});
test('all panels serialize as V2 with the shared underbanner',()=>{
  for(const type of ['ticket']) {
    const p=panel(type); assert.equal(p.flags,D.MessageFlags.IsComponentsV2);
    const json=p.components[0].toJSON(); assert.equal(json.type,17);
    assert.ok(JSON.stringify(json).includes('/footer.png'));
  }
});
test('invalid expiry changes nothing; suspension snapshot survives for recovery',async()=>{
  let f=setup();
  await assert.rejects(()=>issue(f.i,{kind:'infraction',userId:'member',type:'Strike'},'Reason','invalid'),/YYYY/);
  assert.equal(data.cases.length,0); assert.ok(f.target.roles.cache.has('rank'));
  f=setup();
  await issue(f.i,{kind:'infraction',userId:'member',type:'Strike'},'Reason','2099-01-01 12:00');
  assert.deepEqual([...f.target.roles.cache.keys()].sort(),[ROLES.retained,ROLES.suspended].sort());
  assert.ok(data.members[0].suspension.roles.includes('rank'));
  assert.equal(data.members[0].strikes,3); assert.equal(data.cases[0].status,'logged');
  data.members[0].suspension.ends=1;
  f.target.roles.add=async id=>f.target.roles.cache.set(id,{id});
  await recover({guilds:{fetch:async()=>f.guild}});
  assert.ok(f.target.roles.cache.has('rank')); assert.ok(!f.target.roles.cache.has(ROLES.suspended));
  assert.equal(data.members[0].suspension,undefined);
});
test('promotion replaces only selected rank and records reason',async()=>{
  const f=setup(); f.guild.roles.cache.set('newrank',{id:'newrank',managed:false});
  await issue(f.i,{kind:'promotion',userId:'member',previous:'rank',next:'newrank'},'Excellent work','');
  assert.ok(f.target.roles.cache.has('newrank')); assert.ok(!f.target.roles.cache.has('rank'));
  assert.ok(f.target.roles.cache.has(ROLES.retained)); assert.equal(data.cases[0].reason,'Excellent work');
});

test('owner may issue a warning on own record when the marker role is manageable',async()=>{
  const f=setup({strikes:0});
  f.target.roles.cache.set('1538395177448644709',{id:'1538395177448644709'});
  f.target.id='owner';f.target.permissions={has:()=>true};f.target.user={bot:false,username:'Owner'};
  f.guild.members.fetch=async()=>f.target;
  await issue(f.i,{kind:'infraction',userId:'owner',type:'Warning'},'Self test','');
  assert.ok(f.target.roles.cache.has(ROLES.warnings[0]));
});
test('case layouts preserve saved fields with hosted banner assets',()=>{
  const {caseNotice,ticketNotice}=require('../src/legacy-layout');
  const common={_id:'1',userId:'2',actorId:'3',created:Date.now(),reason:'Reason',username:'User',next:{warnings:1,strikes:0,total:1}};
  for(const payload of [caseNotice({...common,kind:'infraction',type:'Warning',notes:'Rule',appealable:true}),caseNotice({...common,kind:'promotion',previous:'4',newRole:'5',newRoleName:'Staff',approvedBy:'3',effectiveDate:'Today'}),ticketNotice({type:'general',owner:'2',reason:'Help'})]) {
    const text=JSON.stringify(payload.components[0].toJSON());assert.ok(!text.includes('attachment://'));assert.equal(payload.flags,D.MessageFlags.IsComponentsV2);
  }
  const cmds=require('../src/commands/config').commands.map(c=>c.toJSON());
  const panels=cmds.find(c=>c.name==='config').options.find(o=>o.name==='panel').options[0].choices.map(c=>c.value);
  assert.deepEqual(panels,['ticket','shift','application']);
});

test('blank suspension expiry creates an indefinite suspension',async()=>{
 const f=setup(); await issue(f.i,{kind:'infraction',userId:'member',type:'Strike'},'Reason','');
 assert.equal(data.members[0].suspension.ends,undefined);
 f.target.roles.add=async id=>f.target.roles.cache.set(id,{id});
 await recover({guilds:{fetch:async()=>f.guild}});
 assert.ok(data.members[0].suspension);assert.ok(f.target.roles.cache.has(ROLES.suspended));
});
