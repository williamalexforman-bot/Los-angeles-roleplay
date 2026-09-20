const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const writes=[];
require.cache[require.resolve('../src/store')]={exports:{collection:()=>({updateOne:async(...args)=>writes.push(args)})}};
const {config,handleInteraction}=require('../src/interactions');
const {GUILD_ID,CHANNELS}=require('../src/settings');
function context(key,type=D.ChannelType.GuildCategory){return {
 guildId:GUILD_ID,guild:{members:{fetch:async()=>({permissions:{has:()=>true}})}},user:{id:'admin'},
 deferReply:async()=>{},editReply:async()=>{},options:{getSubcommand:()=> 'channel',getString:()=>key,getChannel:()=>({id:'channel',type})},
};}
test('all configuration destinations can be found through autocomplete',async()=>{
 for(const key of Object.keys(CHANNELS)){
  let result;await handleInteraction({guildId:GUILD_ID,inGuild:()=>true,isAutocomplete:()=>true,commandName:'config',options:{getSubcommand:()=> 'channel',getFocused:()=>key},respond:async x=>result=x});
  assert.ok(result.some(x=>x.value===key));assert.ok(result.length<=25);
 }
});
test('department-specific ticket destinations accept categories; invalid keys and log categories do not write',async()=>{
 writes.length=0;await config(context('tickets_affairs'));assert.equal(writes.length,1);
 await assert.rejects(config(context('log_roles')),/text channel/);
 await assert.rejects(config(context('unexpected')),/valid destination/);assert.equal(writes.length,1);
});
