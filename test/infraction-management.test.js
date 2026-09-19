const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');let db,failRole=false,notices,logs,roleCalls;
const matches=(r,q)=>Object.entries(q).every(([k,v])=>v&&typeof v==='object'&&'$in'in v?v.$in.includes(r[k]):r[k]===v);
store.collection=name=>{const rows=db[name]||=[];return {findOne:async q=>structuredClone(rows.find(r=>matches(r,q))||null),find:q=>({toArray:async()=>structuredClone(rows.filter(r=>matches(r,q)))}),insertOne:async r=>rows.push(structuredClone(r)),updateOne:async(q,u)=>{const r=rows.find(r=>matches(r,q));if(r)Object.assign(r,structuredClone(u.$set||{}));},replaceOne:async(q,r)=>{const n=rows.findIndex(r=>matches(r,q));if(n<0)rows.push(structuredClone(r));else rows[n]=structuredClone(r);}};};
store.locked=async(_k,fn)=>fn();
const access=require('../src/access');access.requireAccess=async()=>({id:'staff'});
require('../src/logging').record=async(...args)=>logs.push(args);
const M=require('../src/infraction-management'),{ROLES}=require('../src/settings');
const id=n=>String(1500000000000000000n+BigInt(n));
function fixture(types=['Warning','Warning']){
 db={cases:types.map((type,n)=>({_id:id(n),guildId:'g',userId:'u',kind:'infraction',type,created:n+1,status:'logged',reason:'Original',notes:'Original note',appealable:true,actorId:'staff'})),members:[{_id:'g:u',guildId:'g',userId:'u',warnings:2,strikes:0,total:types.length}]};notices=[];logs=[];roleCalls=[];failRole=false;
 const roleCache=new D.Collection([...ROLES.warnings,...ROLES.strikes,ROLES.suspended,ROLES.termination,ROLES.blacklisted,'rank'].map(id=>[id,{id,managed:false}]));
 const cache=new D.Collection([['rank',roleCache.get('rank')],[ROLES.warnings[1],roleCache.get(ROLES.warnings[1])]]);
 const member={roles:{cache,add:async role=>{roleCalls.push(role);if(failRole){failRole=false;throw Error('Discord unavailable');}cache.set(role,roleCache.get(role));},remove:async role=>{roleCalls.push(role);cache.delete(role);}}};
 const guild={id:'g',members:{fetch:async()=>member,fetchMe:async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}})},roles:{cache:roleCache,fetch:async()=>roleCache},channels:{fetch:async()=>({messages:{fetch:async()=>({edit:async p=>notices.push(p)})}})}};
 const i={id:id(90),guildId:'g',guild,user:{id:'staff'}};return {i,member,guild};
}
test('edit updates notice metadata and audit history without role operations',async()=>{
 const {i}=fixture();db.cases[0].messageId='notice';db.cases[0].logChannel='channel';
 await M.change(i,'edit','INF-'+id(0),{reason:'Corrected',appealable:false},'Correcting the record');
 assert.equal(db.cases[0].reason,'Corrected');assert.equal(db.cases[0].appealable,false);assert.equal(db.case_changes[0].before.reason,'Original');assert.equal(db.case_changes[0].after.reason,'Corrected');assert.equal(db.case_changes[0].status,'done');assert.equal(roleCalls.length,0);assert.equal(notices.length,1);assert.equal(logs.length,1);
 assert.ok(notices[0].flags&D.MessageFlags.IsComponentsV2);assert.deepEqual(notices[0].allowedMentions,{parse:[]});
});
test('revoke recalculates counts, replaces tier role, preserves rank and is idempotent',async()=>{
 const {i,member}=fixture();await M.change(i,'revoke',id(0),{},'Wrong member');
 assert.equal(db.members[0].warnings,1);assert.equal(db.members[0].total,1);assert.ok(member.roles.cache.has(ROLES.warnings[0]));assert.ok(!member.roles.cache.has(ROLES.warnings[1]));assert.ok(member.roles.cache.has('rank'));assert.ok(db.cases[0].revoked);assert.equal(db.cases.length,2);
 const calls=roleCalls.length;await M.change(i,'revoke',id(0),{},'Retry');assert.equal(roleCalls.length,calls);
 await assert.rejects(M.change({...i,id:id(91)},'revoke',id(0),{},'Again'),/already been revoked/);
});
test('interrupted role changes persist and recover once without double decrement',async()=>{
 const {i,guild}=fixture();failRole=true;assert.match(await M.change(i,'revoke',id(0),{},'Correction'),/pending/);
 assert.equal(db.case_changes[0].status,'prepared');assert.equal(db.members[0].warnings,2);assert.ok(await M.pending('g','u'));
 await assert.rejects(M.change({...i,id:id(91)},'edit',id(1),{reason:'Change'},'Correction'),/pending/);
 await M.recover({guilds:{fetch:async()=>guild}});assert.equal(db.members[0].warnings,1);assert.equal(db.case_changes[0].status,'done');
 await M.recover({guilds:{fetch:async()=>guild}});assert.equal(db.members[0].warnings,1);assert.equal(logs.length,1);
});
test('bad IDs, other guild cases, no edits and unauthorized actors change nothing',async()=>{
 const {i}=fixture();await assert.rejects(M.change(i,'edit','bad',{},'Correction'),/Case ID/);
 await assert.rejects(M.change({...i,guildId:'other'},'edit',id(0),{reason:'Changed'},'Correction'),/this server/);
 await assert.rejects(M.change(i,'edit',id(0),{},'Correction'),/at least one/);
 await assert.rejects(M.change(i,'edit',id(0),{type:'Strike'},'Correction'),/cannot be edited/);
 const original=access.requireAccess;access.requireAccess=async()=>{throw Error('Denied');};try{await assert.rejects(M.change(i,'revoke',id(0),{},'Correction'),/Denied/);}finally{access.requireAccess=original;}
 assert.equal(db.case_changes?.length||0,0);assert.equal(roleCalls.length,0);
});
test('revoking an earlier warning removes its third-warning strike and automatic suspension',()=>{
 const cases=Array.from({length:9},(_,n)=>({_id:id(n),type:'Warning',created:n}));
 const state={warnings:0,strikes:3,total:9,suspension:{caseId:id(8),roles:['rank',ROLES.warnings[1],ROLES.strikes[1]]}};
 const plan=M.revokePlan(state,cases,cases[0]);assert.equal(plan.next.warnings,2);assert.equal(plan.next.strikes,2);assert.equal(plan.next.total,8);assert.equal(plan.next.suspension,undefined);assert.ok(plan.add.includes('rank'));assert.ok(plan.add.includes(ROLES.warnings[1]));assert.ok(plan.remove.includes(ROLES.suspended));
});
test('unrelated explicit suspension stays active with a corrected restoration snapshot',()=>{
 const cases=[{_id:id(0),type:'Warning',created:1},{_id:id(1),type:'Suspension',created:2}];
 const plan=M.revokePlan({warnings:1,strikes:0,total:2,suspension:{caseId:id(1),roles:['rank',ROLES.warnings[0]]}},cases,cases[0]);
 assert.deepEqual(plan.next.suspension.roles,['rank']);assert.ok(!plan.remove.includes(ROLES.suspended));assert.equal(plan.add.length,0);
});
test('status marker is removed only when no other active case requires it',()=>{
 const cases=[{_id:id(0),type:'Termination',created:1},{_id:id(1),type:'Termination',created:2}];
 assert.ok(!M.revokePlan({},cases,cases[0]).remove.includes(ROLES.termination));cases[1].revoked={};assert.ok(M.revokePlan({},cases,cases[0]).remove.includes(ROLES.termination));
});
test('revoked V2 notice shows revocation and has no appeal control',()=>{
 const p=require('../src/legacy-layout').caseNotice({_id:id(0),kind:'infraction',type:'Warning',created:1,appealable:true,revoked:{actorId:'staff',at:2,reason:'Mistake'}});
 const json=JSON.stringify(p);assert.ok(json.includes('REVOKED'));assert.ok(!json.includes('appeal:'));assert.ok(json.includes('/usms/infraction.png'));
 const options=require('../src/commands/config').commands.find(c=>c.name==='infraction').toJSON().options;assert.deepEqual(options.map(o=>o.name),['issue','edit','revoke']);
});
test('unmanageable role and pending promotion block revocation before any mutation',async()=>{
 let f=fixture();f.guild.members.fetchMe=async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>-1}}});
 await assert.rejects(M.change(f.i,'revoke',id(0),{},'Correction'),/above the bot/);assert.equal(roleCalls.length,0);assert.equal(db.case_changes?.length||0,0);
 f=fixture();db.cases.push({_id:id(40),guildId:'g',userId:'u',kind:'promotion',status:'prepared'});
 await assert.rejects(M.change(f.i,'revoke',id(0),{},'Correction'),/pending/);assert.equal(roleCalls.length,0);assert.equal(db.case_changes?.length||0,0);
});
