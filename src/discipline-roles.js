const {ROLES}=require('./settings');
function normalized(role){return role.name.toLowerCase().replace(/[^a-z0-9]/g,'');}
function first(roles,patterns){return roles.find(r=>patterns.some(p=>p.test(normalized(r))))?.id||null;}
function readInfractionRoles(guild){
 const roles=[...guild.roles.cache.values()].filter(r=>r.id!==guild.id&&!r.managed);
 ROLES.warnings=[first(roles,[/^warning(?:1|i|one)$/,/^w1$/]),first(roles,[/^warning(?:2|ii|two)$/,/^w2$/])].filter(Boolean);
 ROLES.strikes=[first(roles,[/^strike(?:1|i|one)$/,/^s1$/]),first(roles,[/^strike(?:2|ii|two)$/,/^s2$/])].filter(Boolean);
 ROLES.suspended=first(roles,[/^suspend(?:ed|ion)?$/,/^suspendedrole$/]);
 ROLES.termination=first(roles,[/^terminat(?:ed|ion)?$/,/^terminatedrole$/]);
 ROLES.blacklisted=first(roles,[/^blacklist(?:ed)?$/]);
 ROLES.investigation=first(roles,[/^underinvestigation$/,/^investigation$/]);
 return {warnings:[...ROLES.warnings],strikes:[...ROLES.strikes],suspended:ROLES.suspended,termination:ROLES.termination,blacklisted:ROLES.blacklisted,investigation:ROLES.investigation};
}
module.exports={readInfractionRoles};
