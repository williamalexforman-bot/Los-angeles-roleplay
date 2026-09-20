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
