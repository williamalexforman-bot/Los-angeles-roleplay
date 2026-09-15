const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const store=require('../src/store');
store.locked=async(_key,work)=>work();
store.collection=()=>({findOne:async()=>null,insertOne:async()=>{},updateOne:async()=>{}});
const discipline=require('../src/discipline');discipline.settings=async()=>({tickets:'category'});
const {openTicket}=require('../src/tickets');
test('ticket opens with empty user cache using explicitly typed overwrites',async()=>{
 let created=false;
 const guild={id:'guild',client:{users:{cache:new D.Collection(),resolve:()=>null}},roles:{cache:new D.Collection(),fetch:async id=>({id})},members:{fetchMe:async()=>({id:'bot',permissions:{has:()=>true}})},channels:{fetch:async()=>({id:'category',type:D.ChannelType.GuildCategory}),create:async data=>{
  for(const overwrite of data.permissionOverwrites)assert.doesNotThrow(()=>D.PermissionOverwrites.resolve(overwrite,guild));
  assert.equal(data.permissionOverwrites.find(o=>o.id==='requester').type,D.OverwriteType.Member);
  created=true;return {id:'ticket',send:async()=>({id:'notice'})};
 }}};
 assert.match(await openTicket({guild,guildId:'guild',user:{id:'requester'}},'general','Help please'),/ticket is ready/);
 assert.equal(created,true);
});
