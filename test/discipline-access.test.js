const test=require('node:test'),assert=require('node:assert/strict');
const {authorize}=require('../src/discipline');
const {MANAGER,INFRACTION_ROLES}=require('../src/access');
function context(roles,manage=true){
 const actor={id:'actor',roles:{cache:new Set(roles),highest:{comparePositionTo:()=>-1}}};
 const target={id:'target',user:{bot:false},roles:{highest:{}}};
 return {user:{id:'actor'},guild:{ownerId:'owner',members:{fetch:async({user,force})=>{assert.equal(force,true);return user==='actor'?actor:target;},fetchMe:async()=>({permissions:{has:()=>manage}})}}};
}
test('authorized roles work even when target has a higher rank than caller',async()=>{
 await authorize(context([MANAGER]),'target','promotion');
 for(const role of INFRACTION_ROLES)await authorize(context([role]),'target','infraction');
});
test('unprivileged callers and missing bot permissions remain blocked',async()=>{
 await assert.rejects(authorize(context([]),'target','infraction'),/need/);
 await assert.rejects(authorize(context([INFRACTION_ROLES[0]]),'target','promotion'),/need/);
 await assert.rejects(authorize(context([MANAGER],false),'target','promotion'),/Manage Roles/);
});
test('role-gated slash commands explicitly clear legacy default restrictions',()=>{
 const {commands}=require('../src/commands/config');
 for(const name of ['infraction','promotion'])assert.equal(commands.find(c=>c.name===name).toJSON().default_member_permissions,null);
});
