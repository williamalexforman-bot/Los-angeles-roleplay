const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');let db,locks=new Map();
const match=(r,q)=>Object.entries(q).every(([k,v])=>k==='$or'?v.some(c=>match(r,c)):v&&typeof v==='object'&&'$in'in v?v.$in.includes(r[k]):r[k]===v);
store.collection=name=>{const rows=db[name]||=[];return {findOne:async q=>structuredClone(rows.find(r=>match(r,q))||null),find:q=>({toArray:async()=>structuredClone(rows.filter(r=>match(r,q)))}),insertOne:async r=>rows.push(structuredClone(r)),updateOne:async(q,u)=>{const r=rows.find(r=>match(r,q));if(r)Object.assign(r,structuredClone(u.$set));}};};
store.locked=async(key,fn)=>{const previous=locks.get(key)||Promise.resolve();let release;const wait=new Promise(r=>release=r);locks.set(key,wait);await previous;try{return await fn();}finally{release();if(locks.get(key)===wait)locks.delete(key);}};
const {CHANNELS}=require('../src/settings');const R=require('../src/role-requests');
require('../src/logging').record=async()=>{};
function fixture(){
 locks=new Map();db={config:[{_id:'g',role_hr:'hr',roleRequests:'hr-channel'}]};const sent=[],edited=[],grants=[];let fail=false;
 const role={id:'rank',position:20,managed:false,permissions:new D.PermissionsBitField(),mentionable:true};
 const hrRole={id:'hr',position:50,managed:false,permissions:new D.PermissionsBitField(),mentionable:true};
 const member=(id,hr=false,admin=false)=>({id,user:{bot:false},permissions:new D.PermissionsBitField(admin?D.PermissionFlagsBits.Administrator:0n),roles:{cache:new D.Collection(hr?[['hr',hrRole]]:[]),highest:{comparePositionTo:r=>50-r.position},add:async id=>{if(fail){fail=false;throw Error('Network failure');}grants.push(id);members.get('trainee').roles.cache.set(id,role);}}});
 const members=new Map([['trainee',member('trainee')],['hr-user',member('hr-user',true)],['stranger',member('stranger')],['admin',member('admin',false,true)]]);
 const message={id:'message',url:'https://discord.com/channels/g/c/m',edit:async p=>edited.push(p)};
 const channel={id:'hr-channel',guildId:'g',isTextBased:()=>true,permissionsFor:()=>new D.PermissionsBitField(D.PermissionFlagsBits.Administrator),send:async p=>{sent.push(p);return message;},messages:{fetch:async()=>message}};
 const guild={id:'g',channels:{fetch:async()=>channel},roles:{fetch:async id=>id==='hr'?hrRole:role},members:{fetch:async({user})=>members.get(user),fetchMe:async()=>({permissions:new D.PermissionsBitField(D.PermissionFlagsBits.Administrator),roles:{highest:{comparePositionTo:r=>100-r.position}}})}};
 const context=(user='stranger')=>({id:'1551000000000000001',guildId:'g',guild,user:{id:user},options:{getUser:()=>({id:'trainee'}),getRole:()=>role},deferReply:async()=>{},editReply:async()=>{}});
 const decision=(action='approve',user='hr-user')=>({...context(user),channelId:channel.id,message,customId:`role-request:${action}:1551000000000000001`});
 return {guild,role,hrRole,context,decision,sent,edited,grants,members,failOnce:()=>{fail=true;}};
}
test('request is saved, posts V2 to HR with a restricted role ping, and suppresses duplicates',async()=>{
 const f=fixture();await R.submit(f.context());assert.equal(db.role_requests.length,1);assert.equal(f.sent.length,1);assert.equal(db.role_requests[0].channelId,'hr-channel');assert.deepEqual(f.sent[0].allowedMentions,{parse:[],roles:['hr']});assert.ok(f.sent[0].flags&D.MessageFlags.IsComponentsV2);
 await R.submit({...f.context(),id:'1551000000000000002'});assert.equal(f.sent.length,1);
});
test('only fresh HR membership or administrator can approve, without duplicate grants',async()=>{
 const f=fixture();await R.submit(f.context());await assert.rejects(R.handle(f.decision('approve','stranger')),/Only the configured HR/);assert.equal(f.grants.length,0);
 await Promise.all([R.handle(f.decision()),R.handle(f.decision())]);assert.deepEqual(f.grants,['rank']);assert.equal(db.role_requests[0].status,'approved');
 const payload=f.edited.at(-1);assert.deepEqual(payload.allowedMentions,{parse:[]});assert.ok(payload.components[0].toJSON().components.filter(c=>c.type===1).every(row=>row.components[0].disabled));
});
test('deny assigns no role and cannot subsequently be approved',async()=>{
 const f=fixture();await R.submit(f.context());await R.handle(f.decision('deny'));await R.handle(f.decision());assert.equal(f.grants.length,0);assert.equal(db.role_requests[0].status,'denied');
});
test('saved approval recovers after a failed role grant and rechecks reviewer membership',async()=>{
 const f=fixture();await R.submit(f.context());f.failOnce();await R.handle(f.decision());assert.equal(db.role_requests[0].status,'approving');
 f.members.get('hr-user').roles.cache.clear();await R.recover({guilds:{fetch:async()=>f.guild}});assert.equal(f.grants.length,0);
 f.members.get('hr-user').roles.cache.set('hr',f.hrRole);await R.recover({guilds:{fetch:async()=>f.guild}});assert.deepEqual(f.grants,['rank']);assert.equal(db.role_requests[0].status,'approved');
 await R.recover({guilds:{fetch:async()=>f.guild}});assert.equal(f.grants.length,1);
});
test('self approval, elevated roles, managed roles and missing HR are rejected',async()=>{
 let f=fixture();db.config[0].role_hr=null;await assert.rejects(R.submit(f.context()),/Set the HR/);assert.equal(db.role_requests?.length||0,0);
 f=fixture();await R.submit(f.context());f.members.get('trainee').roles.cache.set('hr',f.hrRole);await assert.rejects(R.handle(f.decision('approve','trainee')),/different HR/);
 f.role.permissions=new D.PermissionsBitField(D.PermissionFlagsBits.ManageRoles);await assert.rejects(R.handle(f.decision()),/administrator must approve/);assert.equal(db.role_requests[0].status,'pending');
 f.role.managed=true;await assert.rejects(R.validate(f.guild,'trainee','rank'),/ordinary server role/);
});
test('approval waits during suspension and resumes when it ends',async()=>{
 const f=fixture();await R.submit(f.context());db.members=[{_id:'g:trainee',suspension:{caseId:'c'}}];await R.handle(f.decision());assert.equal(f.grants.length,0);assert.equal(db.role_requests[0].status,'approving');
 delete db.members[0].suspension;await R.recover({guilds:{fetch:async()=>f.guild}});assert.equal(f.grants.length,1);
});
