const D=require('discord.js');
const {requireAccess}=require('./access');
const {ticketAccess,closeTicket}=require('./tickets');
const {v2,panel,button}=require('./panels');
const COMMANDS=['close','closerequest','ticketpanel','lock','unlock','removefrom'];
async function execute(context,command,arg='') {
  if(command==='close') {await closeTicket(context);return 'closed';}
  if(command==='closerequest') {
    const record=await ticketAccess(context);
    if(!arg.trim()||arg.length>1000)throw new Error('Enter a close-request reason between 1 and 1,000 characters.');
    await context.channel.send({...v2('Request to Close Ticket',`<@${record.owner}>, staff have requested permission to close this ticket.\n\n**Reason:** ${D.escapeMarkdown(arg)}\n**Requested by:** <@${context.user.id}>`,[button('close-request:accept','Approve Closure',D.ButtonStyle.Danger),button('close-request:decline','Keep Ticket Open',D.ButtonStyle.Secondary)]),allowedMentions:{parse:[],users:[record.owner]}});
    return 'Close request sent to the ticket opener.';
  }
  if(command==='lock')return require('./channel-locks').lockChannel(context);
  if(command==='unlock')return require('./channel-locks').unlockChannel(context);
  if(command==='removefrom'){
    const id=String(arg).replace(/[<@!>]/g,'');
    if(!/^\d{17,20}$/.test(id))throw new Error('Choose a valid server member. Use `-removefrom @user` or `/removefrom user:`.');
    return require('./tickets').removeFromTicket(context,id);
  }
  await requireAccess(context,command);
  if(command==='ticketpanel') {const channel=await require('./discipline').destination(context.guild,'ticketPanel');await require('./config-delivery').sendPanel(channel,context.guild,panel('ticket'));return `Ticket panel posted in <#${channel.id}>.`;}

  throw new Error('Unknown command.');
}
async function slash(i) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const arg=i.commandName==='closerequest'?i.options.getString('reason',true):i.commandName==='removefrom'?i.options.getUser('user',true).id:'';
  const result=await execute(i,i.commandName,arg);
  if(result!=='closed')await i.editReply(v2('Ticket Command Completed',result,[],true));
}
async function respond(i) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const record=await ticketAccess(i);
  if(i.user.id!==record.owner)throw new Error('Only the ticket opener can answer this close request.');
  if(i.customId==='close-request:accept')await closeTicket(i);
  else {
    await i.message.edit(v2('Ticket Will Remain Open',`<@${record.owner}> declined the closure request, so this ticket will remain open.`));
    await i.editReply(v2('Ticket Kept Open','This ticket will remain available for further assistance.',[],true));
  }
}
module.exports={COMMANDS,execute,slash,respond};
