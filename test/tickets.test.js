const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('discord.js');
let failUpload=false,deleted=false,updated=[];
const record={_id:'ticket',owner:'user',status:'open',type:'general',reason:'Help'};
require.cache[require.resolve('../src/store')]={exports:{locked:async(k,fn)=>fn(),collection:()=>({findOne:async()=>record,updateOne:async(q,u)=>updated.push(u)})}};
const log={permissionsFor:()=>({has:()=>true}),send:async p=>{p.components[0].toJSON();assert.ok(p.files.length);if(failUpload)throw Error('upload failed');}};
require.cache[require.resolve('../src/discipline')]={exports:{destination:async()=>log,settings:async()=>({})}};
const {closeTicket}=require('../src/tickets');
function interaction(){return {channelId:'ticket',user:{id:'user'},guild:{members:{fetch:async()=>({permissions:{has:()=>false}}),fetchMe:async()=>({})}},channel:{permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>new D.Collection()},delete:async()=>{deleted=true;}}};}
test('failed transcript upload must not delete ticket',async()=>{
  failUpload=true;deleted=false;updated=[];
  await assert.rejects(()=>closeTicket(interaction()),/upload/);
  assert.equal(deleted,false);assert.equal(updated.length,0);
});
test('ticket is deleted only after V2 transcript is saved',async()=>{
  failUpload=false;deleted=false;updated=[];
  await closeTicket(interaction());
  assert.equal(deleted,true);assert.ok(updated[0].$set.transcriptSaved);assert.equal(updated[1].$set.status,'closed');
});
test('shared ticket role grants access even for another department',async()=>{
  const {ticketAccess}=require('../src/tickets');
  const {TICKET_ACCESS_ROLE}=require('../src/settings');
  const i=interaction();i.user.id='staff';
  i.guild.members.fetch=async()=>({permissions:{has:()=>false},roles:{cache:{has:id=>id===TICKET_ACCESS_ROLE}}});
  assert.equal((await ticketAccess(i))._id,'ticket');
  i.guild.members.fetch=async()=>({permissions:{has:()=>false},roles:{cache:{has:()=>false}}});
  await assert.rejects(()=>ticketAccess(i),/Only/);
});
