const D=require('discord.js');
const {requireAccess}=require('./access');
const {v2}=require('./panels');
const DEPLOYMENT_CHANNEL='1538399056986906715';
const DEPLOYMENT_ROLE='1538395272986755173';
const DEPLOYMENT_TEXT='Hello Valenti, we have an active deployment going on so make sure to join game and start shift and get playing!';
function parsePrefix(content) {
  const match=/^-(say|deployment)(?:\s+([\s\S]*))?$/i.exec(content);
  return match?{command:match[1].toLowerCase(),text:(match[2]||'').trim()}:null;
}
async function say(context,text) {
  await requireAccess(context,'say');
  if(!text.trim())throw new Error('Type a message after -say, for example: -say Hello Valenti!');
  if(text.length>2000)throw new Error('Keep the message at 2,000 characters or fewer.');
  return context.channel.send({content:text,allowedMentions:{parse:[]}});
}
async function deployment(context) {
  await requireAccess(context,'deployment');
  const channel=await context.guild.channels.fetch(DEPLOYMENT_CHANNEL);
  const role=await context.guild.roles.fetch(DEPLOYMENT_ROLE);
  if(!channel?.isTextBased()||!channel.send)throw new Error('The deployment channel is unavailable.');
  if(!role)throw new Error('The deployment ping role is missing.');
  const me=await context.guild.members.fetchMe();
  const permissions=channel.permissionsFor(me);
  if(!permissions?.has([D.PermissionFlagsBits.ViewChannel,D.PermissionFlagsBits.SendMessages]))throw new Error('The bot needs View Channel and Send Messages in the deployment channel.');
  if(!role.mentionable&&!permissions.has(D.PermissionFlagsBits.MentionEveryone))throw new Error('Make the deployment role mentionable, or grant the bot Mention Everyone in the deployment channel, so the role ping works.');
  return channel.send({...v2('Active Deployment',`<@&${DEPLOYMENT_ROLE}>\n\n${DEPLOYMENT_TEXT}`),allowedMentions:{parse:[],roles:[DEPLOYMENT_ROLE]}});
}
async function handleMessage(message) {
  if(!message.guild||message.author.bot||message.webhookId)return;
  const parsed=parsePrefix(message.content);
  if(!parsed)return;
  const context={guild:message.guild,user:message.author,channel:message.channel};
  try {
    if(parsed.command==='say')await say(context,parsed.text);
    else {
      if(parsed.text)throw new Error('Use -deployment without additional text.');
      const sent=await deployment(context);
      if(message.channel.id!==DEPLOYMENT_CHANNEL)await message.reply({...v2('Deployment Posted',`Sent to <#${DEPLOYMENT_CHANNEL}>.\n[View message](${sent.url})`),allowedMentions:{parse:[],repliedUser:false}});
    }
  }catch(e){
    console.error('Prefix command failed:',e.code||e.name);
    await message.reply({...v2('Command Not Completed',e.name==='Error'?e.message:'Discord could not send that message. Check bot permissions.'),allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});
  }
}
async function handleMessageCommand(i) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const sent=i.commandName==='say'?await say(i,i.options.getString('message',true)):await deployment(i);
  await i.editReply(v2('Message Sent',`[View message](${sent.url})`,[],true));
}
module.exports={parsePrefix,say,deployment,handleMessage,handleMessageCommand,DEPLOYMENT_CHANNEL,DEPLOYMENT_ROLE,DEPLOYMENT_TEXT};
