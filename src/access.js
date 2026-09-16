const MANAGER='1538395177448644709';
const STAFF_ACTION_ROLE='1538395272986755173';
const INFRACTION_ROLES=['1538395250312093768','1538393098185613352',MANAGER,STAFF_ACTION_ROLE];
const PROMOTION_ROLES=[MANAGER,STAFF_ACTION_ROLE];
const rolesFor=kind=>kind==='infraction'?INFRACTION_ROLES:kind==='promotion'?PROMOTION_ROLES:[MANAGER];
function allowed(member,kind) {
  const ids=rolesFor(kind);
  return ids.some(id=>member.roles?.cache?.has(id));
}
async function requireAccess(i,kind) {
  const member=await i.guild.members.fetch({user:i.user.id,force:true});
  if(!allowed(member,kind))throw new Error(`You need ${ (rolesFor(kind)).map(id=>`<@&${id}>`).join(' or ')} to use this action.`);
  return member;
}
module.exports={MANAGER,STAFF_ACTION_ROLE,INFRACTION_ROLES,PROMOTION_ROLES,allowed,requireAccess};
