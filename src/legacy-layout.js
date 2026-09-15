const D=require('discord.js');
const {v2,button}=require('./panels');
const {TICKETS,TICKET_ACCESS_ROLE}=require('./settings');
const clean=(s)=>D.escapeMarkdown(String(s||'Not provided.')).slice(0,1000);
function caseNotice(item, url) {
  if(item.kind==='promotion') {
    const text=[ 'The High Ranking Team at Valenti Crime Family has issued a staff promotion.', '',
      `**Member:** <@${item.userId}>`,`**Old Rank:** <@&${item.previous}>`,`**New Role:** <@&${item.newRole}>`,
      `**Reason:** ${clean(item.reason)}`,`**Approved By:** <@${item.approvedBy}>`,`**Effective Date:** ${clean(item.effectiveDate)}`,
      `**Issued By:** <@${item.actorId}>`,`**Submitted:** <t:${Math.floor(item.created/1000)}:F>`].join('\n');
    const payload=v2('🎖️ Staff Promotion',text);
    payload.components[0].setAccentColor(0x2ecc71);
    payload.components[0].addSectionComponents(new D.SectionBuilder().addTextDisplayComponents(new D.TextDisplayBuilder().setContent('Valenti Crime Family • Staff Management')).setButtonAccessory(button('promotion:display',`Promoted to ${item.newRoleName || 'new rank'}`.slice(0,80)).setDisabled(true)));
    if(url)payload.components[0].addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`[View Promotion Post](${url})`));
    return payload;
  }
  const text=[`**User:** <@${item.userId}> • ${clean(item.username)}`,`**Staff:** <@${item.actorId}>`,
    `**Status:** Active • **Appealable:** ${item.appealable?'✅ Yes':'❌ No'}`,`**Notes:** ${clean(item.notes)}`,`**Reason:** ${clean(item.reason)}`,
    `**Issued:** <t:${Math.floor(item.created/1000)}:F>`,`**Warnings:** ${item.next?.warnings || 0}/3 • **Strikes:** ${item.next?.strikes || 0} • **Total:** ${item.next?.total || 0}`];
  if(item.evidence)text.push(`**Evidence:** ${clean(item.evidence)}`);
  if(item.next?.suspension?.ends)text.push(`**Suspension Ends:** <t:${Math.floor(item.next.suspension.ends/1000)}:F>`);
  if(item.next?.suspension && !item.next.suspension.ends)text.push('> **Suspension Ends:** Until ended by staff');
  const payload=v2(`⚖️ Staff ${item.type} • INF-${item._id}`,text.join('\n'),[button(`appeal:${item._id}`,item.appealable?'Appeal Infraction':'Not Appealable').setDisabled(!item.appealable)]);
  payload.components[0].setAccentColor(0xe74c3c);
  if(url)payload.components[0].addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`[View Infraction](${url})`));
  return payload;
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
module.exports={caseNotice,ticketNotice};
