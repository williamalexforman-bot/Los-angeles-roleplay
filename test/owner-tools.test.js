const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('discord.js');
const {OWNER_ID,sendDm,changeRole}=require('../src/owner-tools');
const {commands}=require('../src/commands/config');
const {parsePrefix}=require('../src/messages');

test('owner DM and role commands are registered with prefix fallbacks',()=>{
 for(const name of ['dm','role'])assert.ok(commands.some(command=>command.name===name));
 assert.equal(parsePrefix(`-dm <@${OWNER_ID}> hello`).command,'dm');
 assert.equal(parsePrefix(`-role remove <@${OWNER_ID}> <@&123456789012345678>`).command,'role');
});

test('only configured owner can DM and one message is sent',async()=>{
 await assert.rejects(()=>sendDm({user:{id:'1'}},{id:'2',send:async()=>{}},'hello'),/Only the configured bot owner/);
 const sent=[];const result=await sendDm({user:{id:OWNER_ID}},{id:'2',send:async payload=>sent.push(payload)},'hello');
 assert.equal(sent.length,1);assert.equal(sent[0].content,'hello');assert.match(result,/Sent a DM/);
});

test('role command honors Discord manage-role hierarchy',async()=>{
 const guild={id:'g',members:{fetchMe:async()=>({permissions:{has:p=>p===D.PermissionFlagsBits.ManageRoles},roles:{highest:{comparePositionTo:()=>1}}})}};
 const role={id:'r',name:'Rank',guild,managed:false};
 const calls=[];const member={id:'m',guild,manageable:true,roles:{cache:new Map(),add:async r=>calls.push(['add',r.id]),remove:async r=>calls.push(['remove',r.id])}};
 const result=await changeRole({user:{id:OWNER_ID},guild},'add',member,role);
 assert.deepEqual(calls,[['add','r']]);assert.match(result,/Added/);
 guild.members.fetchMe=async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>0}}});
 await assert.rejects(()=>changeRole({user:{id:OWNER_ID},guild},'remove',member,role),/Move the bot role above/);
});
