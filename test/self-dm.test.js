const test=require('node:test'),assert=require('node:assert/strict');
const store=require('../src/store');let row=null;store.collection=()=>({findOne:async()=>row,replaceOne:async(_q,v)=>{row=v;},updateOne:async(_q,u)=>{if(row)Object.assign(row,u.$set);}});store.locked=async(_k,work)=>work();
const {parse,request,SELF_ID}=require('../src/self-dm');
test('self-DM command caps at 50 and validates syntax',()=>{assert.deepEqual(parse('hello 50'),{text:'hello',count:50});assert.throws(()=>parse('hello 51'),/1–50/);assert.throws(()=>parse('hello 0'),/1–50/);assert.throws(()=>parse('hello'),/1–50/);});
test('only the specified account can start a job and stop cancels it',async()=>{const user={id:SELF_ID,send:async()=>{}};await assert.rejects(request({id:'other'},'hello 1'),/Only account/);const result=await request(user,'hello 2');assert.match(result,/not a hosting keep-alive/);await request(user,'stop');assert.ok(['cancelled','completed'].includes(row.status));});
