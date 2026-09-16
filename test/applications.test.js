const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');
let rows=new Map(),seq=100n,dms=[],review=new Map(),granted=[],denyDM=false,failRole=false;
const copy=x=>x?structuredClone(x):null;
function matches(a,q){return Object.entries(q).every(([k,v])=>k==='$or'?v.some(c=>matches(a,c)):v&&typeof v==='object'?(v.$in?v.$in.includes(a[k]):v.$ne!==undefined?a[k]!==v.$ne:false):a[k]===v);}
store.locked=async(_key,work)=>work();
store.collection=()=>({findOne:async q=>copy([...rows.values()].find(a=>matches(a,q))),insertOne:async a=>{rows.set(a._id,copy(a));},updateOne:async(q,u)=>{const a=[...rows.values()].find(a=>matches(a,q));if(a)Object.assign(a,copy(u.$set));},find:q=>({toArray:async()=>[...rows.values()].filter(a=>matches(a,q)).map(copy)})});
const {MANAGER}=require('../src/access');
const logged=[];require('../src/logging').record=async(...args)=>{logged.push(args);};
const A=require('../src/applications');
function user(id='applicant'){return {id,send:async p=>{if(denyDM)throw Object.assign(Error('DMs closed'),{code:50007});const m={id:String(++seq),payload:p};dms.push(m);return m;}};}
const channel={messages:{fetch:async arg=>{if(typeof arg==='string'){if(!review.has(arg))throw Object.assign(Error('Missing'),{code:10008});return review.get(arg);}return new D.Collection(review);}},send:async p=>{const m={id:String(++seq),author:{id:'bot'},nonce:p.nonce,payload:p,edit:async x=>{m.payload=x;}};review.set(m.id,m);return m;}};
const member={roles:{cache:new Set(),add:async id=>{if(failRole)throw Error('Role failure');granted.push(id);member.roles.cache.add(id);}}};
const guild={channels:{fetch:async id=>{assert.equal(id,'1538603960909168680');return channel;}},members:{fetch:async arg=>arg.user==='applicant'?member:{roles:{cache:new Set(arg.user==='manager'?[MANAGER]:[])}},fetchMe:async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}})},roles:{fetch:async id=>({id,managed:false})}};
const client={user:{id:'bot'},users:{fetch:async id=>user(id)},guilds:{fetch:async()=>guild}};
function interaction(customId,who='applicant',inGuild=false){return {id:'123456789012345678',customId,user:user(who),guild,guildId:'guild',channelId:'1538603960909168680',client,inGuild:()=>inGuild,deferReply:async()=>{},editReply:async()=>{}};}
function reset(){rows=new Map();dms=[];review=new Map();granted=[];denyDM=false;failRole=false;member.roles.cache.clear();}
async function fill(){
 await A.start(interaction('application:start','applicant',true));
 for(const text of ['Player 12345','No previous experience','I enjoy organized roleplay','I follow instructions and work well with others','8','9'])await A.dm({author:user(),content:text,id:String(++seq),guild:null});
 for(const step of [6,7]){const i=interaction(`application:answer:123456789012345678:${step}`);i.message={id:rows.get(i.id).promptId};i.values=['Yes'];await A.handle(i);}
 await A.handle(interaction('application:submit:123456789012345678'));
}
test('all eight DM answers persist; review and acceptance add exact roles',async()=>{
 reset();await fill();const a=rows.get('123456789012345678');assert.equal(a.status,'submitted');assert.equal(a.answers.length,8);
 await A.recoverApplications(client);assert.ok(review.size>=1);
 for(const m of review.values()){assert.ok(m.payload.flags&D.MessageFlags.IsComponentsV2);m.payload.components[0].toJSON();}
 await assert.rejects(A.handle(interaction(`application:accept:${a._id}`,'outsider',true)),/need/);
 await A.handle(interaction(`application:accept:${a._id}`,'manager',true));
 assert.equal(a.status,'accepted');assert.deepEqual(granted,A.PASS_ROLES);assert.ok(logged.some(e=>e[0]==='applications'&&e[2]==='Application accepted'));
 await A.recoverApplications(client);assert.equal(a.notified,true);
 await assert.rejects(A.handle(interaction(`application:reject:${a._id}`,'manager',true)),/already been reviewed/);
});
test('blocked DMs preserve session and stale dropdowns cannot advance it',async()=>{
 reset();denyDM=true;await assert.rejects(A.start(interaction('application:start','applicant',true)),/Enable DMs/);
 assert.equal(rows.size,1);denyDM=false;await A.start(interaction('application:start','applicant',true));assert.equal(rows.size,1);
 const i=interaction('application:answer:123456789012345678:6');i.message={id:'bad'};i.values=['Yes'];await assert.rejects(A.handle(i),/latest question/);
 assert.equal(rows.get(i.id).step,0);
});
test('failed acceptance resumes role assignment without losing staff decision',async()=>{
 reset();await fill();await A.recoverApplications(client);failRole=true;
 await assert.rejects(A.handle(interaction('application:accept:123456789012345678','manager',true)),/Acceptance saved/);
 assert.equal(rows.get('123456789012345678').status,'accepting');failRole=false;await A.recoverApplications(client);
 assert.equal(rows.get('123456789012345678').status,'accepted');assert.deepEqual(granted,A.PASS_ROLES);
});
test('rejection does not grant roles and final review buttons are disabled',async()=>{
 reset();await fill();await A.handle(interaction('application:reject:123456789012345678','manager',true));await A.recoverApplications(client);
 assert.equal(granted.length,0);const a=rows.get('123456789012345678');assert.equal(a.status,'rejected');
 const last=A.reviewPages(a).at(-1).components[0].toJSON();assert.ok(last.components.filter(x=>x.type===1).every(r=>r.components[0].disabled));
});
test('long escaped answers fit V2 limits, scales validate, yes/no use menus',()=>{
 const a={_id:'1',status:'submitted',userId:'2',answers:Array(8).fill('*'.repeat(500)),suggestion:'x'.repeat(450)};
 for(const p of A.reviewPages(a)){const data=p.components[0].toJSON();const text=data.components.filter(c=>c.type===10).map(c=>c.content).join('');assert.ok(text.length<=4000);}
 assert.throws(()=>A.validate(4,'11'),/1 to 10/);assert.throws(()=>A.validate(6,'maybe'),/dropdown/);
 for(const step of [6,7])assert.equal(A.prompt({_id:'1',step}).components[0].toJSON().components.at(-1).components[0].type,3);
 const notice=require('../src/legacy-layout').ticketNotice({type:'general',owner:'1',reason:'Help'}).components[0].toJSON();
 const buttons=notice.components.at(-1).components;assert.equal(buttons[0].emoji.id,'1549441861675126979');assert.equal(buttons[1].emoji.id,'1549543557197463625');
});
