const D=require('discord.js');
const {requireAccess}=require('./access');
const {v2,section}=require('./panels');
const {settings,destination}=require('./discipline');
const DEPLOYMENT_TEXT='An active deployment is underway. Join the game, check in with the deployment lead, and follow the session instructions.';
function parsePrefix(content){content=content.replace(/^-continue-emojis\s*$/i,'-continueemojis');content=content.replace(/^-add\s+emojis\s*$/i,'-addemojis').replace(/^-continue\s+emojis\s*$/i,'-continueemojis').replace(/^-force\s+stop(?:\s+emojis)?\s*$/i,'-forcestopemojis');const match=/^-(addemojis|add-emojis|continueemojis|forcestopemojis|say|shift|deployment|close|closerequest|ticketpanel)(?:\s+([\s\S]*))?$/i.exec(content);return match?{command:match[1].toLowerCase(),text:(match[2]||'').trim()}:null;}
async function say(context,text){
 await requireAccess(context,'say');
 if(!text.trim()||text.length>2000)throw new Error('Enter a message between 1 and 2,000 characters.');
 const channel=context.channel||await context.guild.channels.fetch(context.channelId);
 if(!channel?.send)throw new Error('Use /say in a server text channel or thread.');
 return channel.send({content:text,allowedMentions:{parse:['users','roles'],repliedUser:false}});
}
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
  if(!['closerequest','say','shift'].includes(parsed.command)&&parsed.text)throw new Error('This command takes no additional text.');
  if(parsed.command==='say')await say(context,parsed.text);
  else if(parsed.command==='shift'){
    const [action='status',memberText]=parsed.text.toLowerCase().split(/\s+/).filter(Boolean);
    const targetId=memberText?.replace(/[<@!>]/g,'');
    if((targetId&&action!=='view')||parsed.text.split(/\s+/).length>2||(targetId&&!/^\d{17,20}$/.test(targetId)))throw new Error('Use -shift view @member.');
    if(!['start','end','status','view'].includes(action))throw new Error('Use -shift start, -shift end, -shift status or -shift view @member.');
    const shifts=require('./shifts');const result=await shifts.changeShift(context,action,targetId);
    await context.channel.send(v2('Staff Shift',result));
  }
  else if(['addemojis','add-emojis'].includes(parsed.command))await require('./emoji-install').prefix(context);
  else if(parsed.command==='continueemojis')await require('./emoji-install').continuePrefix(context);
  else if(parsed.command==='forcestopemojis')await context.channel.send(v2('Emoji Jobs Stopped',await require('./emoji-install').forceStop(context)));
  else if(parsed.command==='deployment')await deployment(context);
  else {const result=await require('./utilities').execute(context,parsed.command,parsed.text);if(result==='closed')return;}
  await message.delete().catch(async e=>{if(e.code!==10008){console.error('Prefix cleanup failed:',e.code||e.name);await context.channel.send(v2('Command Completed','The command succeeded, but I need Manage Messages here to delete your command message.')).catch(()=>{});}});
 }catch(e){await message.reply({...v2('Command Not Completed',require('./config-delivery').describeError(e)),allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});}
}
async function handleMessageCommand(i){await i.deferReply({flags:D.MessageFlags.Ephemeral});const sent=i.commandName==='say'?await say(i,i.options.getString('message',true)):await deployment(i);await i.editReply(v2('Message Sent',`[View message](${sent.url})`,[],true));}
module.exports={say,parsePrefix,deployment,handleMessage,handleMessageCommand,DEPLOYMENT_TEXT};
