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
 assert.equal(parsePrefix('-sayhello'),null);assert.equal(parsePrefix('hello'),null);
});
test('say requires management and prevents unexpected pings',async()=>{
 const {sent,context}=setup();await say(context,'Hello @everyone');assert.equal(sent[0].content,'Hello @everyone');assert.deepEqual(sent[0].allowedMentions.parse,[]);
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
