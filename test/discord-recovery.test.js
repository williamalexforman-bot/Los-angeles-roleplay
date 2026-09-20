const test=require('node:test'),assert=require('node:assert/strict');
const {discordRecovery}=require('../src/discord-recovery');
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(){let time=0;const clients=[],logs=[];let fail=false;
 const recovery=discordRecovery({token:'test',now:()=>time,log:(...x)=>logs.push(x),createClient:()=>{
 const c={ready:false,destroyed:false,isReady(){return this.ready&&!this.destroyed;},async destroy(){this.destroyed=true;},async login(token){assert.equal(token,'test');assert.equal(this.destroyed,false);if(fail)throw Object.assign(Error(),{code:'NETWORK'});}};clients.push(c);return c;
 }});return {recovery,clients,logs,time:n=>time=n,fail:v=>fail=v};}
test('failed login retries with a fresh client, never the destroyed instance',async()=>{
 const f=fixture();f.fail(true);await f.recovery.start();await flush();f.time(29999);await f.recovery.tick();assert.equal(f.clients.length,1);
 f.time(30000);f.fail(false);await f.recovery.tick();await flush();assert.equal(f.clients.length,2);assert.ok(f.clients[0].destroyed);
});
test('normal resumes keep client; persistent outages replace it and later outages recover again',async()=>{
 const f=fixture();await f.recovery.start();f.clients[0].ready=true;f.recovery.tick();
 f.time(1000);f.clients[0].ready=false;f.recovery.tick();f.time(110000);f.clients[0].ready=true;f.recovery.tick();assert.equal(f.clients.length,1);
 f.time(200000);f.clients[0].ready=false;f.recovery.tick();f.time(320000);await Promise.all([f.recovery.tick(),f.recovery.tick()]);assert.equal(f.clients.length,2);
 f.clients[1].ready=true;f.recovery.tick();f.time(400000);f.clients[1].ready=false;f.recovery.tick();f.time(520000);await f.recovery.tick();assert.equal(f.clients.length,3);
});
test('invalidated session is rebuilt after backoff',async()=>{const f=fixture();await f.recovery.start();f.recovery.invalidated();f.time(30000);await f.recovery.tick();assert.equal(f.clients.length,2);});
test('hung teardown triggers fallback without launching a second live connection',async()=>{
 let created=0,fatal=0,time=0;
 const r=discordRecovery({token:'x',now:()=>time,destroyMs:5,fatal:()=>fatal++,createClient:()=>{created++;return {isReady:()=>false,login:async()=>{},destroy:()=>new Promise(()=>{})};}});
 await r.start();time=120000;await r.tick();assert.equal(fatal,1);assert.equal(created,1);
});
