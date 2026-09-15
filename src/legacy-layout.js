const D=require('discord.js');
const {v2,button}=require('./panels');
const {TICKETS,TICKET_ACCESS_ROLE}=require('./settings');
const clean=(s)=>D.escapeMarkdown(String(s||'Not provided.')).slice(0,1000);
const NOTICE_VERSION=3;
function caseNotice(item, url) {
  const box=new D.ContainerBuilder();
  const text=content=>box.addTextDisplayComponents(new D.TextDisplayBuilder().setContent(content));
  const divider=()=>box.addSeparatorComponents(new D.SeparatorBuilder());
  const field=(label,value)=>`› **${label}**\n${value}`;
  if(item.kind==='promotion') {
    text('🎉 **Staff Promotion**');
    text(`*Promoted by* <@${item.actorId}>`);
    text([
      field('Promoted staff',`<@${item.userId}>`),
      field('Old role',item.previous?`<@&${item.previous}>`:'None'),
      field('New role',item.newRole?`<@&${item.newRole}>`:'Not recorded'),
      field('Extra notes',clean(item.reason)),
    ].join('\n\n'));
  } else {
    const roman=n=>({1:'I',2:'II',3:'III'}[n]||String(n));
    let type=item.type;
    if(type==='Warning'&&item.next?.warnings)type=`Warning ${roman(item.next.warnings)}`;
    else if(type==='Strike'&&item.next?.strikes)type=`Strike ${roman(item.next.strikes)}`;
    else if(type==='Warning'&&item.next?.warnings===0&&item.next?.strikes)type=`Strike ${roman(item.next.strikes)} (third warning)`;
    text('⚠️ **Staff Infraction Issued**');
    text(`> Greetings <@${item.userId}>, a **${type}** has been issued against your account.`);
    divider();
    const fields=[field('Reason',clean(item.reason)),field('Type',type),field('Issued by',`<@${item.actorId}>`),field('Appeal Status',item.appealable?'Appealable':'Not Appealable')];
    if(item.notes)fields.push(field('Extra notes',clean(item.notes)));
    if(item.evidence)fields.push(field('Evidence',clean(item.evidence)));
    if(item.next?.suspension)fields.push(field('Suspension ends',item.next.suspension.ends?`<t:${Math.floor(item.next.suspension.ends/1000)}:F>`:'Until ended by staff'));
    text(fields.join('\n\n'));
  }
  divider();
  text(`-# Case ID: ${item._id} • <t:${Math.floor(item.created/1000)}:F>`);
  if(item.kind==='infraction'&&item.next)text(`-# Warnings: ${item.next.warnings || 0}/3 • Strikes: ${item.next.strikes || 0} • Total infractions: ${item.next.total || 0}`);
  if(item.kind==='promotion') {
    if(item.approvedBy)text(`-# Approved by <@${item.approvedBy}>${item.effectiveDate?` • Effective: ${clean(item.effectiveDate)}`:''}`);
  } else if(item.appealable)box.addActionRowComponents(new D.ActionRowBuilder().addComponents(button(`appeal:${item._id}`,'Appeal Infraction')));
  if(url)text(`[View ${item.kind==='promotion'?'Promotion':'Infraction'}](${url})`);
  return {components:[box],flags:D.MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
function ticketNotice(record) {
  const emojis={general:'🎫',affairs:'📋',high:'⭐'};
  const text=[`<@${record.owner}> • <@&${TICKET_ACCESS_ROLE}>`, 'Welcome to **Valenti Crime Family**. A staff member will assist you shortly.', '',`**Opened By:** <@${record.owner}>`,'**Reason:**',clean(record.reason)];
  if(record.extra)text.push('',clean(record.extra));
  if(record.claimedBy)text.push('',`**Claimed By:** <@${record.claimedBy}>`);
  text.push('','*Realism at its Finest*');
  const controls=[
    button('ticket:claim',record.claimedBy?'Claimed':'Claim',D.ButtonStyle.Success).setEmoji({id:'1549441861675126979'}).setDisabled(Boolean(record.claimedBy)),
    button('ticket:close','Close',D.ButtonStyle.Danger).setEmoji({id:'1549543557197463625'}),button('ticket:escalate','Escalate',D.ButtonStyle.Secondary)];
  const payload=v2(`${emojis[record.type] || '🎫'} ${TICKETS[record.type]} Ticket`,text.join('\n'));
  payload.components[0].addSeparatorComponents(new D.SeparatorBuilder()).addActionRowComponents(new D.ActionRowBuilder().addComponents(...controls));
  return payload;
}
module.exports={NOTICE_VERSION,caseNotice,ticketNotice};
