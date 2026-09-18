const D=require('discord.js');
const {requireAccess}=require('./access');
const {ticketAccess,closeTicket}=require('./tickets');
const {v2,panel,button}=require('./panels');
const COMMANDS=['close','closerequest','purge','ticketpanel'];
async function execute(context,command,arg='') {
  if(command==='close') {await closeTicket(context);return 'closed';}
  if(command==='closerequest') {
    const record=await ticketAccess(context);
    if(!arg.trim()||arg.length>1000)throw new Error('Enter a close-request reason between 1 and 1,000 characters.');
    await context.channel.send({...v2('Ticket Close Request',`<@${record.owner}>, may we close this ticket?\n\n**Reason:** ${D.escapeMarkdown(arg)}\n**Requested by:** <@${context.user.id}>`,[button('close-request:accept','Close Ticket',D.ButtonStyle.Danger),button('close-request:decline','Keep Open',D.ButtonStyle.Secondary)]),allowedMentions:{parse:[],users:[record.owner]}});
    return 'Close request sent to the ticket opener.';
  }
  await requireAccess(context,command);
  if(command==='ticketpanel') {await context.channel.send(panel('ticket'));return 'Ticket panel posted.';}
  if(command==='purge') {
    if(!/^\d+$/.test(String(arg))||Number(arg)<1||Number(arg)>100)throw new Error('Enter a whole number from 1 to 100.');
    const me=await context.guild.members.fetchMe();
    if(!context.channel.permissionsFor(me)?.has([D.PermissionFlagsBits.ViewChannel,D.PermissionFlagsBits.ReadMessageHistory,D.PermissionFlagsBits.ManageMessages]))throw new Error('The bot needs View Channel, Read Message History and Manage Messages here.');
    if(!context.channel.bulkDelete)throw new Error('Messages cannot be purged in this channel.');
    const messages=await context.channel.messages.fetch({limit:Number(arg),...(context.sourceMessageId?{before:context.sourceMessageId}:{})});
    const deleted=await context.channel.bulkDelete(messages,true);
    return `Deleted ${deleted.size} messages. Messages older than 14 days are skipped.`;
  }
  throw new Error('Unknown command.');
}
async function slash(i) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const arg=i.commandName==='closerequest'?i.options.getString('reason',true):i.commandName==='purge'?String(i.options.getInteger('amount',true)):'';
  const result=await execute(i,i.commandName,arg);
  if(result!=='closed')await i.editReply(v2('Command Completed',result,[],true));
}
async function respond(i) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const record=await ticketAccess(i);
  if(i.user.id!==record.owner)throw new Error('Only the ticket opener can answer this close request.');
  if(i.customId==='close-request:accept')await closeTicket(i);
  else {
    await i.message.edit(v2('Ticket Staying Open',`<@${record.owner}> chose to keep this ticket open.`));
    await i.editReply(v2('Ticket Staying Open','Your ticket will remain open.',[],true));
  }
}
module.exports={COMMANDS,execute,slash,respond};
