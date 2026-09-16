const test=require('node:test'),assert=require('node:assert/strict');
const {MANAGER}=require('../src/access');
const {parsePrefix,say,deployment,handleMessage,DEPLOYMENT_CHANNEL,DEPLOYMENT_ROLE,DEPLOYMENT_TEXT}=require('../src/messages');
function setup(access=true){
 const sent=[];const channel={id:'current',send:async p=>{sent.push(p);return {url:'https://discord.com/channels/1/2/3'};},permissionsFor:()=>({has:()=>true}),isTextBased:()=>true};
 const context={user:{id:'person'},channel,guild:{members:{fetch:async()=>({roles:{cache:new Set(access?[MANAGER]:[])}}),fetchMe:async()=>({})},channels:{fetch:async id=>{assert.equal(id,DEPLOYMENT_CHANNEL);return channel;}},roles:{fetch:async id=>{assert.equal(id,DEPLOYMENT_ROLE);return {mentionable:true};}}}};
 return {sent,context};
}
test('prefix parsing preserves multiline text and ignores other commands',()=>{
 assert.deepEqual(parsePrefix('-say Hello\nValenti'),{command:'say',text:'Hello\nValenti'});
 assert.deepEqual(parsePrefix('-DEPLOYMENT'),{command:'deployment',text:''});
 assert.deepEqual(parsePrefix('-verificationpanel'),{command:'verificationpanel',text:''});
 assert.equal(parsePrefix('-sayhello'),null);assert.equal(parsePrefix('hello'),null);
});
test('say requires management and enables user and role mentions without mass pings',async()=>{
 const {sent,context}=setup();await say(context,'Hello @everyone');assert.equal(sent[0].content,'Hello @everyone');assert.deepEqual(sent[0].allowedMentions.parse,['users','roles']);
 await assert.rejects(()=>say(setup(false).context,'test'),/need/);await assert.rejects(()=>say(context,''),/Type/);
});
test('deployment sends exact requested content and allows only specified role ping',async()=>{
 const {sent,context}=setup();await deployment(context);
 const payload=sent[0],json=JSON.stringify(payload.components[0].toJSON());
 assert.ok(json.includes(DEPLOYMENT_TEXT));assert.ok(json.includes(`<@&${DEPLOYMENT_ROLE}>`));assert.deepEqual(payload.allowedMentions,{parse:[],roles:[DEPLOYMENT_ROLE]});
 await assert.rejects(()=>deployment(setup(false).context),/need/);
});
test('bot messages and DMs never trigger prefix commands',async()=>{
 await handleMessage({guild:null,content:'-deployment'});
 await handleMessage({guild:{},author:{bot:true},content:'-say repeat'});
});
test('successful prefix deletes caller message only after sending',async()=>{
 const {sent,context}=setup();let deleted=false;
 await handleMessage({guild:context.guild,channel:context.channel,author:context.user,content:'-say hi',delete:async()=>{assert.equal(sent[0].content,'hi');deleted=true;}});
 assert.equal(deleted,true);
});
test('denied prefix retains caller message',async()=>{
 const {context}=setup(false);let deleted=false;
 await handleMessage({guild:context.guild,channel:context.channel,author:context.user,content:'-say hi',delete:async()=>{deleted=true;},reply:async()=>{}});
 assert.equal(deleted,false);
});
test('cleanup failure does not resend the command output',async()=>{
 const {sent,context}=setup();
 await handleMessage({guild:context.guild,channel:context.channel,author:context.user,content:'-say hi',delete:async()=>{throw Object.assign(new Error('Missing permissions'),{code:50013});}});
 assert.equal(sent.filter(p=>p.content==='hi').length,1);assert.equal(sent.length,2);
});
test('verificationpanel checks access, posts to configured destination and removes successful invocation',async()=>{
 const verification=require('../src/verification');const original=verification.ensurePanel;let posts=0;
 verification.ensurePanel=async client=>{assert.equal(client.user.id,'bot');posts++;return {url:'https://discord.com/channels/1/2/3'};};
 try {
  for(const [access,text,expected] of [[true,'',1],[false,'',1],[true,' extra',1]]){
   const {context}=setup(access);let deleted=false;
   await handleMessage({guild:context.guild,channel:context.channel,author:context.user,client:{user:{id:'bot'}},content:'-verificationpanel'+text,delete:async()=>{deleted=true;},reply:async()=>{}});
   assert.equal(posts,expected);assert.equal(deleted,access&&!text);
  }
 } finally {verification.ensurePanel=original;}
});
