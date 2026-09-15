const MANAGER='1538395177448644709';
const INFRACTION_ROLES=['1538395250312093768',MANAGER];
function allowed(member,kind) {
  const ids=kind==='infraction'?INFRACTION_ROLES:[MANAGER];
  return ids.some(id=>member.roles?.cache?.has(id));
}
async function requireAccess(i,kind) {
  const member=await i.guild.members.fetch({user:i.user.id,force:true});
  if(!allowed(member,kind))throw new Error(`You need ${ (kind==='infraction'?INFRACTION_ROLES:[MANAGER]).map(id=>`<@&${id}>`).join(' or ')} to use this action.`);
  return member;
}
module.exports={MANAGER,INFRACTION_ROLES,allowed,requireAccess};
