const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('discord.js');
let failUpload=false,deleted=false,updated=[];
const record={_id:'ticket',owner:'user',status:'open',support:'support',type:'general',reason:'Help'};
require.cache[require.resolve('../src/store')]={exports:{locked:async(k,fn)=>fn(),collection:()=>({findOne:async()=>record,updateOne:async(q,u)=>updated.push(u)})}};
const log={permissionsFor:()=>({has:()=>true}),send:async p=>{p.components[0].toJSON();assert.ok(p.files.length);if(failUpload)throw Error('upload failed');}};
require.cache[require.resolve('../src/discipline')]={exports:{destination:async()=>log,settings:async()=>({})}};
const {closeTicket}=require('../src/tickets');
function interaction(){return {channelId:'ticket',user:{id:'user'},guild:{members:{fetch:async()=>({permissions:{has:()=>false}}),fetchMe:async()=>({})}},channel:{send:async p=>{assert.equal(p.content,'🔒 Closing Ticket');assert.ok(updated[0].$set.transcriptSaved);assert.equal(deleted,false);},permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>new D.Collection()},delete:async()=>{deleted=true;}}};}
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
test('saved support role grants ticket access',async()=>{
  const {ticketAccess}=require('../src/tickets');
  const TICKET_ACCESS_ROLE='support';
  const i=interaction();i.user.id='staff';
  i.guild.members.fetch=async()=>({permissions:{has:()=>false},roles:{cache:{has:id=>id===TICKET_ACCESS_ROLE}}});
  assert.equal((await ticketAccess(i))._id,'ticket');
  i.guild.members.fetch=async()=>({permissions:{has:()=>false},roles:{cache:{has:()=>false}}});
  await assert.rejects(()=>ticketAccess(i),/Only/);
});
test('member-specific deny removes ordinary staff from a ticket',async()=>{
  const {removeFromTicket}=require('../src/tickets');const edits=[];
  const i=interaction();i.id='command';i.user.id='staff';i.guildId='guild';i.guild.id='guild';i.guild.ownerId='owner';
  i.guild.members.fetch=async({user})=>user==='staff'?{id:'staff',permissions:{has:()=>false},roles:{cache:{has:id=>id==='support'}}}:{id:user,permissions:{has:()=>false},roles:{cache:{has:()=>true}}};
  i.guild.members.fetchMe=async()=>({id:'bot',permissions:{has:flag=>flag===D.PermissionFlagsBits.ManageChannels}});
  i.channel.permissionOverwrites={edit:async(id,permissions,options)=>edits.push({id,permissions,options})};
  const result=await removeFromTicket(i,'target');
  assert.match(result,/can no longer view/);assert.equal(edits.length,1);assert.equal(edits[0].id,'target');assert.equal(edits[0].permissions.ViewChannel,false);
});
