const D=require('discord.js');
const {collection}=require('./store');
const {settings}=require('./discipline');
const {v2}=require('./panels');
const {deliver}=require('./ticket-panel-delivery');
async function escalate(i,record){
 if(record.escalationNotified)return 'This ticket has already been escalated to HR Support.';
 const config=await settings(i.guildId);
 const roleId=config.support_high || config.role_management;
 if(!roleId)throw new Error('Configure HR Support staff using /config ticket-access department:high.');
 const role=await i.guild.roles.fetch(roleId);
 if(!role || role.id===i.guildId)throw new Error('Set a valid HR Support role using /config ticket-access department:high.');
 const me=await i.guild.members.fetchMe();
 const permissions=i.channel.permissionsFor(me);
 if(!permissions?.has(D.PermissionFlagsBits.ManageRoles))throw new Error('The bot needs Manage Roles in this ticket to grant high-rank access.');
 if(!role.mentionable && !permissions.has(D.PermissionFlagsBits.MentionEveryone))throw new Error('Make the high-rank role mentionable or grant the bot Mention Everyone here so escalation can notify staff.');
 await i.channel.permissionOverwrites.edit(role.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true},{type:D.OverwriteType.Role});
 const update={type:'high',support:role.id,escalatedBy:record.escalatedBy || i.user.id,panelPending:true};
 await collection('tickets').updateOne({_id:record._id},{$set:update});
 Object.assign(record,update);
 await i.channel.send({...v2('Ticket Escalated for Review',`<@&${role.id}> • This ticket requires your attention.\n\n**Ticket opener:** <@${record.owner}>\n**Escalated by:** <@${record.escalatedBy}>`),nonce:`escalate:${record._id}`,enforceNonce:true,allowedMentions:{parse:[],roles:[role.id]}});
 record.escalationNotified=true;
 await collection('tickets').updateOne({_id:record._id},{$set:{escalationNotified:true}});
 try {
  const message=await i.channel.messages.fetch(record.panelId || i.message.id);
  const result=await deliver(i.channel,record,message);
  await collection('tickets').updateOne({_id:record._id},{$set:{panelPending:false,panelId:result.message.id}});
 } catch(e){ console.error('Escalated ticket panel refresh pending:',record._id,e.code||e.name); }
 return 'Ticket escalated to HR Support. The role has access and has been notified.';
}
module.exports={escalate};
