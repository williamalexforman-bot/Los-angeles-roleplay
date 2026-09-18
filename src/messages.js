const D=require('discord.js');
const {requireAccess}=require('./access');
const {v2,section}=require('./panels');
const DEPLOYMENT_CHANNEL=require('./settings').CHANNELS.deployment;
const DEPLOYMENT_ROLE=null;
const DEPLOYMENT_TEXT='Hello PCSO, we have an active deployment going on so make sure to join game and start shift and get playing!';
function parsePrefix(content) {
  content=content.replace(/^-add\s+emojis\s*$/i, "-addemojis");
  content=content.replace(/^-delete\s+emojis\s*$/i, "-deleteemojis");
  content=content.replace(/^-continue\s+emojis\s*$/i, "-continueemojis");
  content=content.replace(/^-stop\s+deleting\s*$/i, "-stopdeleting").replace(/^-force\s+delete\s*$/i, "-forcedelete");
  content=content.replace(/^-force\s+stop(?:\s+emojis)?\s*$/i, "-forcestopemojis");
  const match=/^-(forcestopemojis|stopdeleting|forcedelete|continueemojis|continue-emojis|deleteemojis|delete-emojis|addemojis|add-emojis|say|deployment|close|closerequest|purge|ticketpanel|verificationpanel)(?:\s+([\s\S]*))?$/i.exec(content);
  return match?{command:match[1].toLowerCase(),text:(match[2]||'').trim()}:null;
}
async function say(context,text) {
  await requireAccess(context,'say');
  if(!text.trim())throw new Error('Type a message after -say, for example: -say Hello PCSO!');
  if(text.length>2000)throw new Error('Keep the message at 2,000 characters or fewer.');
  return context.channel.send({content:text,allowedMentions:{parse:['users','roles'],repliedUser:false}});
}
async function deployment(context) {
  await requireAccess(context,'deployment');
  const config=await require('./discipline').settings(context.guild.id);
  const channel=await require('./discipline').destination(context.guild,'deployment');
  const role=config.role_deployment_ping ? await context.guild.roles.fetch(config.role_deployment_ping) : null;
  if(!channel?.isTextBased()||!channel.send)throw new Error('The deployment channel is unavailable.');
  const me=await context.guild.members.fetchMe();
  const permissions=channel.permissionsFor(me);
  if(!permissions?.has([D.PermissionFlagsBits.ViewChannel,D.PermissionFlagsBits.SendMessages]))throw new Error('The bot needs View Channel and Send Messages in the deployment channel.');
  if(role && !role.mentionable&&!permissions.has(D.PermissionFlagsBits.MentionEveryone))throw new Error('Make the deployment role mentionable, or grant the bot Mention Everyone in the deployment channel, so the role ping works.');
  return channel.send({...v2('Active Deployment',[`${role ? `<@&${role.id}>\n\n` : ''}${DEPLOYMENT_TEXT}`,
    section('join_game','Join the Deployment','Join the server in ER:LC and get ready to participate with the department.'),
    section('check_in','Start Your Shift','Use `/shift start` or the **Start Shift** button when you begin. Your time is saved when you end your shift.'),
    section('briefing','Stay Coordinated','Watch server announcements and follow the directions of the high ranks leading the session. Ask for help if you are unsure what to do.'),
    section('conduct','Represent PCSO','Follow server rules, respect other players, and keep your roleplay professional.'),
    section('check_out','Before You Leave','Use `/shift end` to save your time. Check `/quota status` for the current weekly requirement.')
  ],[],false,'deployment'),allowedMentions:{parse:[],roles:role?[role.id]:[]}});
}
async function handleMessage(message) {
  if(!message.guild||message.author.bot||message.webhookId)return;
  const parsed=parsePrefix(message.content);
  if(!parsed)return;
  const context={guild:message.guild,user:message.author,channel:message.channel,guildId:message.guild.id,channelId:message.channel.id,sourceMessageId:message.id};
  try {
    if(parsed.command==='forcestopemojis') {
      if(parsed.text)throw new Error('Use -force stop emojis without extra text.');
      const result=await require('./emoji-install').forceStop(context);
      await context.channel.send(v2('Emoji Jobs Stopped',result));
    }
    else if(parsed.command==='stopdeleting') {
      if(parsed.text)throw new Error('Use -stop deleting without extra text.');
      const result=await require('./emoji-install').stopDeleting(context);
      await context.channel.send(v2('Emoji Deletion',result));
    } else if(parsed.command==='forcedelete') {
      if(parsed.text)throw new Error('Use -force delete without extra text.');
      await require('./emoji-install').removePrefix(context,true);
    }
    else if(['continueemojis','continue-emojis'].includes(parsed.command)) {
      if(parsed.text)throw new Error('Use -continue emojis without extra text.');
      await require('./emoji-install').continuePrefix(context);
    }
    else if(['deleteemojis','delete-emojis'].includes(parsed.command)) {
      if(parsed.text)throw new Error('Use -delete emojis without extra text.');
      await require('./emoji-install').removePrefix(context);
    }
    else if(['addemojis','add-emojis'].includes(parsed.command)) {
      if(parsed.text)throw new Error('Use -addemojis without extra text.');
      await require('./emoji-install').prefix(context);
    }
    else if(parsed.command==='say')await say(context,parsed.text);
    else if(parsed.command==='verificationpanel') {
      if(parsed.text)throw new Error('Use -verificationpanel without additional text.');
      await requireAccess(context,'verificationpanel');
      const verification=require('./verification');
      const sent=await verification.ensurePanel({user:message.client.user,channels:message.guild.channels}, (await require('./discipline').settings(context.guildId)).verification);
      if(message.channel.id!==sent.channelId)await message.channel.send(v2('Verification Panel Ready',`[View panel](${sent.url}) in <#${sent.channelId}>.`));
    }
    else if(require('./utilities').COMMANDS.includes(parsed.command)) {
      if(['close','ticketpanel'].includes(parsed.command)&&parsed.text)throw new Error('This command does not take extra text.');
      const result=await require('./utilities').execute(context,parsed.command,parsed.text);
      if(result==='closed')return;
      if(parsed.command==='purge')await message.channel.send(v2('Messages Deleted',result));
    } else {
      if(parsed.text)throw new Error('Use -deployment without additional text.');
      const sent=await deployment(context);
      if(message.channel.id!==DEPLOYMENT_CHANNEL)await message.channel.send({...v2('Deployment Posted',`Sent to <#${DEPLOYMENT_CHANNEL}>.\n[View message](${sent.url})`),allowedMentions:{parse:[],repliedUser:false}});
    }
    try { await message.delete(); }
    catch (e) {
      if(e.code!==10008) {
        console.error('Prefix message cleanup failed:',e.code||e.name);
        await message.channel.send({...v2('Message Sent', 'The command succeeded, but I could not delete your command message. Give the bot Manage Messages in this channel.'),allowedMentions:{parse:[]}}).catch(()=>{});
      }
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
