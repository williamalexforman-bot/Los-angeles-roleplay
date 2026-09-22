const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const storePath=require.resolve('../src/store'),accessPath=require.resolve('../src/access');
let saved;
require.cache[storePath]={exports:{locked:async(_key,work)=>work(),collection:()=>({findOne:async()=>saved,insertOne:async record=>{saved=record;},deleteOne:async()=>{saved=null;}})}};
require.cache[accessPath]={exports:{requireAccess:async()=>({})}};
const {lockChannel,unlockChannel}=require('../src/channel-locks');
function overwrite(id,type,allow=[],deny=[]){return {id,type,allow:new D.PermissionsBitField(allow),deny:new D.PermissionsBitField(deny)};}
function fixture(){
 saved=null;const edits=[],deletes=[];
 const cache=new D.Collection([
  ['guild',overwrite('guild',D.OverwriteType.Role,[D.PermissionFlagsBits.SendMessages,D.PermissionFlagsBits.ViewChannel])],
  ['staff',overwrite('staff',D.OverwriteType.Role,[D.PermissionFlagsBits.SendMessages])],
 ]);
 const context={channelId:'channel',user:{id:'moderator'},guild:{id:'guild',members:{fetchMe:async()=>({permissions:{has:flag=>flag===D.PermissionFlagsBits.ManageChannels}})}},channel:{type:D.ChannelType.GuildText,permissionOverwrites:{cache,edit:async(id,permissions,options)=>edits.push({id,permissions,options}),delete:async id=>deletes.push(id)}}};
 return {context,edits,deletes};
}
test('lock denies speaking and unlock restores every saved overwrite',async()=>{
 const {context,edits}=fixture();
 assert.match(await lockChannel(context),/now locked/);assert.equal(edits.length,2);assert.ok(edits.every(operation=>operation.permissions.SendMessages===false));
 assert.match(await unlockChannel(context),/previous permissions were restored/);assert.equal(edits.length,4);assert.ok(edits.slice(2).every(operation=>operation.permissions.SendMessages===true));assert.equal(saved,null);
});
