const test=require('node:test'),assert=require('node:assert/strict');
let allowed=true;
require.cache[require.resolve('../src/access')]={exports:{requireAccess:async()=>{if(!allowed)throw Error('Staff role required.');}}};
const {handleMessage}=require('../src/messages');
test('say sends once then removes invocation; denied commands send no bot text',async()=>{
 const calls=[];
 const message={id:'id',guild:{id:'g'},author:{id:'u',bot:false},content:'-say Hello <@123456789012345678>',channel:{id:'c',send:async p=>calls.push(['send',p])},delete:async()=>calls.push(['delete']),reply:async()=>calls.push(['error'])};
 await handleMessage(message);assert.deepEqual(calls.map(x=>x[0]),['send','delete']);assert.equal(calls[0][1].content,'Hello <@123456789012345678>');assert.deepEqual(calls[0][1].allowedMentions.parse,['users','roles']);
 allowed=false;calls.length=0;await handleMessage(message);assert.deepEqual(calls.map(x=>x[0]),['error']);
});
test('/say follows the actual slash router, defers and sends normal text once',async()=>{
 allowed=true;const calls=[];const D=require('discord.js');
 const i={guildId:require('../src/settings').GUILD_ID,guild:{},user:{id:'u'},commandName:'say',inGuild:()=>true,isButton:()=>false,isChatInputCommand:()=>true,options:{getString:name=>{assert.equal(name,'message');return 'Hello server';}},deferReply:async p=>{assert.equal(p.flags,D.MessageFlags.Ephemeral);calls.push('defer');},channel:{send:async p=>{assert.equal(p.content,'Hello server');calls.push('send');return {url:'https://discord.com/channels/g/c/m'};}},editReply:async()=>calls.push('confirm')};
 await require('../src/interactions').handleInteraction(i);assert.deepEqual(calls,['defer','send','confirm']);
});
test('prefix deletion failure never resends say content',async()=>{
 allowed=true;const sent=[];await handleMessage({guild:{id:'g'},author:{id:'u'},content:'-say hello',channel:{send:async p=>sent.push(p)},delete:async()=>{throw {code:50013};},reply:async()=>{}});
 assert.equal(sent.filter(p=>p.content==='hello').length,1);
});
