const test=require('node:test'),assert=require('node:assert/strict');
const {runTask,startTask}=require('../src/runtime');
test('task failures are handled and scheduling survives first-run failure',async()=>{
 let attempts=0;
 const work=async()=>{attempts++;throw Object.assign(new Error('failure'),{code:'TEST_FAILURE'});};
 await runTask('Test',work);
 const timer=await startTask('Test',work,60000);
 try {assert.equal(attempts,2);assert.ok(timer);}finally{clearInterval(timer);}
});
test('additional infraction role does not grant unrelated management access',()=>{
 const {allowed}=require('../src/access');const member={roles:{cache:new Set(['1538393098185613352'])}};
 assert.equal(allowed(member,'infraction'),true);assert.equal(allowed(member,'promotion'),false);
});
