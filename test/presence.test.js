const test=require('node:test'), assert=require('node:assert/strict');
const {Collection,ActivityType}=require('discord.js');
const {updatePresence}=require('../src/presence');
test('presence uses configured guild count, updates changes and ignores other guilds',()=>{
 const cache=new Collection([['server',{memberCount:1200}],['other',{memberCount:50}]]);let payload;
 const client={isReady:()=>true,guilds:{cache},user:{setPresence:p=>payload=p}};
 updatePresence(client,{GUILD_ID:'server'});assert.equal(payload.activities[0].name,'over 1,200 server members');assert.equal(payload.activities[0].type,ActivityType.Watching);
 cache.get('server').memberCount=1201;updatePresence(client,{GUILD_ID:'server'});assert.equal(payload.activities[0].name,'over 1,201 server members');
 payload=null;updatePresence(client,{GUILD_ID:'missing'});assert.equal(payload,null);
});
