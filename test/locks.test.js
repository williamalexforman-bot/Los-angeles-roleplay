const test=require('node:test'),assert=require('node:assert/strict');
const {withLock}=require('../src/locks');
function database(initial){let saved=initial;return {get saved(){return saved;},findOneAndUpdate:async(q,u)=>{if(saved&&saved.expires>q.expires.$lte)throw Object.assign(Error('Duplicate'),{code:11000});saved={_id:q._id,...u.$set};return saved;},updateOne:async(q,u)=>{if(saved?.owner===q.owner)Object.assign(saved,u.$set);},deleteOne:async q=>{if(saved?.owner===q.owner)saved=null;}};}
test('expired locks are reclaimed without waiting for Mongo TTL cleanup',async()=>{
 const db=database({_id:'ticket:1',owner:'old',expires:new Date(0)});let ran=false;
 await withLock(db,'ticket:1',async()=>{ran=true;},{waitMs:10,retryMs:1});assert.ok(ran);assert.equal(db.saved,null);
});
test('concurrent requests wait and never enter the critical section together',async()=>{
 const db=database();let active=0,max=0;
 const work=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;};
 await Promise.all([withLock(db,'ticket:1',work,{retryMs:1}),withLock(db,'ticket:1',work,{retryMs:1})]);assert.equal(max,1);
});
test('active locks are never stolen and failed work releases ownership',async()=>{
 const db=database({_id:'ticket:1',owner:'active',expires:new Date(Date.now()+60000)});
 await assert.rejects(withLock(db,'ticket:1',async()=>assert.fail(),{waitMs:2,retryMs:1}),/still being processed/);assert.equal(db.saved.owner,'active');
 const free=database();await assert.rejects(withLock(free,'x',async()=>{throw Error('work failed');}),/work failed/);assert.equal(free.saved,null);
});
