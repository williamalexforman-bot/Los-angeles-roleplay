const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const {ROLES}=require('../src/settings'),{readInfractionRoles}=require('../src/discipline-roles');
test('reads current server infraction roles by their names without old IDs',()=>{
 const roles=new D.Collection([['w1',{id:'w1',name:'Warning 1',managed:false}],['w2',{id:'w2',name:'Warning II',managed:false}],['s1',{id:'s1',name:'Strike 1',managed:false}],['s2',{id:'s2',name:'Strike II',managed:false}],['sus',{id:'sus',name:'Suspended',managed:false}],['term',{id:'term',name:'Terminated',managed:false}],['bl',{id:'bl',name:'Blacklisted',managed:false}],['inv',{id:'inv',name:'Under Investigation',managed:false}]]);
 const found=readInfractionRoles({id:'server',roles:{cache:roles}});assert.deepEqual(found.warnings,['w1','w2']);assert.deepEqual(found.strikes,['s1','s2']);assert.equal(ROLES.suspended,'sus');assert.equal(ROLES.termination,'term');assert.equal(ROLES.blacklisted,'bl');assert.equal(ROLES.investigation,'inv');
});
