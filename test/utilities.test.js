const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const tickets=require('../src/tickets');let closed=0;
tickets.ticketAccess=async()=>({owner:'owner'});tickets.closeTicket=async()=>{closed++;};
const {execute,respond}=require('../src/utilities');
const {MANAGER}=require('../src/access');
function context(access=true){return {user:{id:'owner'},guild:{members:{fetch:async()=>({roles:{cache:new Set(access?[MANAGER]:[])}}),fetchMe:async()=>({})}},channel:{permissionsFor:()=>({has:()=>true}),messages:{fetch:async opts=>{assert.equal(opts.limit,5);assert.equal(opts.before,'command');return new D.Collection();}},bulkDelete:async(_messages,filter)=>{assert.equal(filter,true);return {size:3};}},sourceMessageId:'command'};}
test('purge validates limits, enforces access and excludes prefix invocation',async()=>{
 const c=context();assert.match(await execute(c,'purge','5'),/Deleted 3/);
 for(const value of ['0','101','1.5','abc'])await assert.rejects(execute(c,'purge',value),/whole number/);
 await assert.rejects(execute(context(false),'purge','5'),/need/);
});
test('close request includes reason and can only be accepted by ticket opener',async()=>{
 const c=context();c.channel.send=async p=>{assert.ok(JSON.stringify(p).includes('Resolved'));};
 await execute(c,'closerequest','Resolved');
 const i={...c,user:{id:'other'},customId:'close-request:accept',deferReply:async()=>{}};
 await assert.rejects(respond(i),/Only the ticket opener/);assert.equal(closed,0);
 i.user.id='owner';await respond(i);assert.equal(closed,1);
});
test('new slash commands serialize and disciplinary notices are V2',()=>{
 const {commands}=require('../src/commands/config');for(const c of commands)c.toJSON();
 for(const name of ['close','closerequest','purge','ticketpanel'])assert.ok(commands.some(c=>c.name===name));
 const {caseNotice}=require('../src/legacy-layout');
 for(const kind of ['infraction','promotion']){const p=caseNotice({kind,type:'Warning',_id:'case',userId:'user',actorId:'actor',created:Date.now()});assert.ok(p.flags&D.MessageFlags.IsComponentsV2);assert.equal(p.components[0].toJSON().type,17);}
});
