const D=require('discord.js');
const MANAGER=null, STAFF_ACTION_ROLE=null, INFRACTION_ROLES=[], PROMOTION_ROLES=[];
function allowed(member,kind,config={}) {
 if((member.id && member.id===member.guild?.ownerId) || member.permissions?.has(D.PermissionFlagsBits.Administrator))return true;
 return [config.role_staff,config.role_management,config['role_'+kind]].filter(Boolean).some(id=>member.roles?.cache?.has(id));
}
async function requireAccess(i,kind) {
 const member=await i.guild.members.fetch({user:i.user.id,force:true});
 if(allowed(member,kind))return member;
 const config=await require('./discipline').settings(i.guildId || i.guild.id);
 if(!allowed(member,kind,config))throw new Error('Administrator or a configured staff role is required. An administrator can set access with /config staff-role.');
 return member;
}
module.exports={MANAGER,STAFF_ACTION_ROLE,INFRACTION_ROLES,PROMOTION_ROLES,allowed,requireAccess};
