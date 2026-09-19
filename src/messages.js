const D=require('discord.js');
const {requireAccess}=require('./access');
const {v2,section}=require('./panels');
const {settings,destination}=require('./discipline');
const DEPLOYMENT_TEXT='An active deployment is underway. Join the game, check in with the deployment lead, and follow the session instructions.';
function parsePrefix(content){const match=/^-(deployment|close|closerequest|ticketpanel)(?:\s+([\s\S]*))?$/i.exec(content);return match?{command:match[1].toLowerCase(),text:(match[2]||'').trim()}:null;}
async function deployment(context){
 await requireAccess(context,'deployment');
 const config=await settings(context.guild.id),channel=await destination(context.guild,'deployment');
 const role=config.role_deployment_ping?await context.guild.roles.fetch(config.role_deployment_ping):null;
 if(config.role_deployment_ping&&!role)throw new Error('The deployment ping role is missing. Configure it again.');
 const me=await context.guild.members.fetchMe();
 if(role&&!role.mentionable&&!channel.permissionsFor(me)?.has(D.PermissionFlagsBits.MentionEveryone))throw new Error('Make the deployment role mentionable or grant the bot Mention Everyone in this channel.');
 return require('./config-delivery').sendPanel(channel,context.guild,{...v2('Active Deployment',[
 `${role?`<@&${role.id}>\n\n`:''}${DEPLOYMENT_TEXT}`,
 section('briefing','Briefing','Review the current assignment and coordinate with your supervisor.'),
 section('conduct','Professional Conduct','Follow server rules and maintain professional roleplay.')],[],false,'deployment'),allowedMentions:{parse:[],roles:role?[role.id]:[]}});
}
async function handleMessage(message){
 if(!message.guild||message.author.bot||message.webhookId)return;
 const parsed=parsePrefix(message.content);if(!parsed)return;
 const context={guild:message.guild,guildId:message.guild.id,channel:message.channel,channelId:message.channel.id,user:message.author,sourceMessageId:message.id};
 try{
  if(parsed.command!=='closerequest'&&parsed.text)throw new Error('This command takes no additional text.');
  if(parsed.command==='deployment')await deployment(context);
  else {const result=await require('./utilities').execute(context,parsed.command,parsed.text);if(result==='closed')return;}
  await message.delete().catch(e=>{if(e.code!==10008)console.error('Prefix cleanup failed:',e.code||e.name);});
 }catch(e){await message.reply({...v2('Command Not Completed',require('./config-delivery').describeError(e)),allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});}
}
async function handleMessageCommand(i){await i.deferReply({flags:D.MessageFlags.Ephemeral});const sent=await deployment(i);await i.editReply(v2('Deployment Posted',`[View message](${sent.url})`,[],true));}
module.exports={parsePrefix,deployment,handleMessage,handleMessageCommand,DEPLOYMENT_TEXT};
