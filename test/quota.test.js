const test=require('node:test'),assert=require('node:assert/strict');
const {nextFriday,totals}=require('../src/quota');
const access=require('../src/access');const MANAGER='manager';const allowed=(m,k)=>access.allowed(m,k,{role_management:MANAGER,role_infraction:'1538395250312093768'});
test('Friday 10 AM Eastern survives daylight saving changes',()=>{
 assert.equal(new Date(nextFriday(Date.parse('2026-03-06T15:00:00Z'))).toISOString(),'2026-03-13T14:00:00.000Z');
 assert.equal(new Date(nextFriday(Date.parse('2026-10-30T14:00:00Z'))).toISOString(),'2026-11-06T15:00:00.000Z');
 assert.equal(new Date(nextFriday(Date.parse('2026-09-17T12:00:00Z'))).toISOString(),'2026-09-18T14:00:00.000Z');
 assert.equal(new Date(nextFriday(Date.parse('2026-09-18T13:59:59Z'))).toISOString(),'2026-09-18T14:00:00.000Z');
});
test('quota counts ended shifts only and clips to period without double counting',()=>{
 const shifts=[{userId:'a',started:0,ended:2000},{userId:'a',started:2000,ended:3000},{userId:'a',started:3000,ended:null},{userId:'b',started:1000,ended:5000}];
 assert.equal(totals(shifts,1000,4000).get('a'),2000);assert.equal(totals(shifts,1000,4000).get('b'),undefined);
 assert.equal(totals(shifts,3000,6000).get('a'),0);
});
test('exact role gates allow both infraction roles and restrict promotions/quota',()=>{
 const member=id=>({roles:{cache:new Set([id])}});
 assert.equal(allowed(member(MANAGER),'promotion'),true);
 assert.equal(allowed(member('1538395250312093768'),'infraction'),true);
 assert.equal(allowed(member('1538395250312093768'),'promotion'),false);
 assert.equal(allowed(member('1538395250312093768'),'quota'),false);
 assert.equal(allowed(member(MANAGER),'quota'),true);
 const cmds=require('../src/commands/config').commands.map(c=>c.toJSON());
 for(const name of ['infraction','promotion','quota'])assert.ok(!cmds.find(c=>c.name===name).default_member_permissions);
});
