const D=require('discord.js');
const {v2}=require('./panels');
const OWNER_ID='1262469782897295461';

function requireOwner(context){
 const id=context.user?.id||context.author?.id;
 if(id!==OWNER_ID)throw new Error('Only the configured bot owner can use this command.');
}
async function sendDm(context,user,message){
 requireOwner(context);
 const content=String(message||'').trim();
 if(!user?.id)throw new Error('Choose a valid Discord user.');
 if(!content||content.length>2000)throw new Error('Enter a message between 1 and 2,000 characters.');
 try{await user.send({content,allowedMentions:{parse:[]}});}
 catch(error){if(error?.code===50007)throw new Error('That user is not accepting DMs from this bot.');throw error;}
 return `Sent a DM to <@${user.id}>.`;
}
async function changeRole(context,action,member,role){
 requireOwner(context);
 if(!['add','remove'].includes(action))throw new Error('Choose add or remove.');
 if(!member?.guild||member.guild.id!==context.guild.id)throw new Error('Choose a member of this server.');
 if(!role||role.guild.id!==context.guild.id||role.id===context.guild.id)throw new Error('Choose an ordinary server role, not @everyone.');
 if(role.managed)throw new Error('Discord-managed and integration roles cannot be changed manually.');
 const me=await context.guild.members.fetchMe();
 if(!me.permissions.has(D.PermissionFlagsBits.ManageRoles))throw new Error('Give the bot the Manage Roles permission.');
 if(me.roles.highest.comparePositionTo(role)<=0)throw new Error(`Move the bot role above ${role.name} in Server Settings → Roles.`);
 if(!member.manageable)throw new Error('Discord will not let the bot manage this member because of role hierarchy or server ownership.');
 const has=member.roles.cache.has(role.id);
 if(action==='add'&&has)return `<@${member.id}> already has <@&${role.id}>.`;
 if(action==='remove'&&!has)return `<@${member.id}> does not have <@&${role.id}>.`;
 await member.roles[action](role,`Owner command used by ${context.user?.id||context.author?.id}`);
 return `${action==='add'?'Added':'Removed'} <@&${role.id}> ${action==='add'?'to':'from'} <@${member.id}>.`;
}
async function slash(i){
 await i.deferReply({flags:D.MessageFlags.Ephemeral});
 if(i.commandName==='dm')return i.editReply(v2('Direct Message Sent',await sendDm(i,i.options.getUser('user',true),i.options.getString('message',true)),[],true));
 const member=await i.guild.members.fetch(i.options.getUser('user',true).id);
 return i.editReply(v2('Member Role Updated',await changeRole(i,i.options.getSubcommand(),member,i.options.getRole('role',true)),[],true));
}
module.exports={OWNER_ID,requireOwner,sendDm,changeRole,slash};
