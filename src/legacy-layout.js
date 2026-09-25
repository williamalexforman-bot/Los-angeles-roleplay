const D=require('discord.js');
const E=require('./panel-emojis');
const {v2,button}=require('./panels');
const {TICKETS,TICKET_ACCESS_ROLE}=require('./settings');
const clean=(s)=>D.escapeMarkdown(String(s||'Not provided.')).slice(0,1000);
const NOTICE_VERSION=10;
function caseNotice(item, url) {
  const box=new D.ContainerBuilder().setAccentColor(0x5685EF);
  const text=content=>box.addTextDisplayComponents(new D.TextDisplayBuilder().setContent(content));
  const divider=()=>box.addSeparatorComponents(new D.SeparatorBuilder());
  const field=(label,value)=>`› **${E.heading(label,item.guildId)}**\n${value}`;
  if(item.kind==='promotion') {
    text(`${E.icon('promotion','🎉',item.guildId)} **Staff Promotion**`);
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
    text(`${E.icon('infraction','',item.guildId)} **CLEARWATER FIRE DEPARTMENT**\nDisciplinary Notice`);
    divider();
    text(`**${E.heading("Member",item.guildId)}**\n<@${item.userId}>\n\n**${E.heading("Action recorded",item.guildId)}**\n${type}`);
    divider();
    const detail=(label,value)=>`**${E.heading(label,item.guildId)}**\n${value}`;
    const fields=[detail('Reason for this action',clean(item.reason))];
    if(item.notes)fields.push(detail('Staff notes',clean(item.notes)));
    if(item.evidence)fields.push(detail('Supporting evidence',clean(item.evidence)));
    if(item.next?.suspension&&!item.revoked)fields.push(detail('Suspension ends',item.next.suspension.ends?`<t:${Math.floor(item.next.suspension.ends/1000)}:F>`:'Until ended by staff'));
    text(fields.join('\n\n'));
    divider();
    if(item.revoked)text(`**REVOKED** by <@${item.revoked.actorId}> • <t:${Math.floor(item.revoked.at/1000)}:F>\n${clean(item.revoked.reason).slice(0,220)}`);
    if(item.lastEdited)text(`-# Edited by <@${item.lastEdited.actorId}> • <t:${Math.floor(item.lastEdited.at/1000)}:F>`);
    text(`**Review details**\nRecorded by <@${item.actorId}>\n${item.revoked?'This infraction is revoked and no longer counts.':item.appealable?'You may request a review using the appeal button below.':'This action is not open for appeal.'}`);
  }
  divider();
  text(`-# Case ID: ${require('./short-id').short(item._id,'INF-')} • <t:${Math.floor(item.created/1000)}:F>`);
  if(item.kind==='infraction'&&item.next)text(`-# Counts when issued — Warnings: ${item.next.warnings || 0}/3 • Strikes: ${item.next.strikes || 0} • Total infractions: ${item.next.total || 0}`);
  if(item.kind==='promotion') {
    if(item.approvedBy)text(`-# Approved by <@${item.approvedBy}>${item.effectiveDate?` • Effective: ${clean(item.effectiveDate)}`:''}`);
  } else if(item.appealable&&!item.revoked)box.addActionRowComponents(new D.ActionRowBuilder().addComponents(button(`appeal:${item._id}`,'Appeal Infraction')));
  if(url)text(`[View ${item.kind==='promotion'?'Promotion':'Infraction'}](${url})`);
  require('./branding').decorate(box, item.kind==='promotion'?'promotion':'infraction');
  return {components:[box],flags:D.MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
function ticketNotice(record) {
  const staff=record.support || TICKET_ACCESS_ROLE;
  const icon=(name,fallback)=>E.icon(name,fallback,record.guildId);
  const text=[
    `@everyone\n\n${icon("welcome","👋")} Thanks <@${record.owner}> for contacting support!`,
    `Thank you for opening a ticket with **Clearwater Fire & Rescue**. ${staff ? `<@&${staff}>` : "Our support team"} will assist you as soon as possible. Please wait at least **12 hours** before pinging staff about a response. If you are reporting a user, provide their **User ID**, a clear **screenshot**, and a detailed **reason** below so the report can be reviewed efficiently.`,
    `${icon('ticket','🎫')} **Ticket Information**\n${icon('member','•')} **Opener:** <@${record.owner}>\n${icon('reference','•')} **Ticket ID:** \`${require('./short-id').short(record._id,'TICKET-')}\`\n${icon('support','•')} **Department:** ${TICKETS[record.type] || 'Support'}\n${icon('reason','•')} **Reason** ${require('./ticket-format').ticketReason(record.reason)}`
  ];
  if(record.extra)text.push(`${icon('evidence','•')} **Additional Information**\n${clean(record.extra)}`);
  if(record.claimedBy)text.push(`${icon('claim','•')} **Claimed by:** <@${record.claimedBy}>`);
  if(record.escalatedBy)text.push(`${icon('escalated','•')} **Escalated to HR Support** by <@${record.escalatedBy}>`);
  const controls=[
    button('ticket:claim',record.claimedBy?'Claimed':'Claim',D.ButtonStyle.Success).setEmoji(E.component('claim',{name:'🙋'},record.guildId)).setDisabled(Boolean(record.claimedBy)),
    button('ticket:close','Close',D.ButtonStyle.Danger).setEmoji(E.component('close',{name:'🔒'},record.guildId)),button('ticket:escalate',record.escalatedBy?'Escalated':'Escalate',D.ButtonStyle.Secondary).setEmoji(E.component('escalated',{name:'⬆️'},record.guildId)).setDisabled(Boolean(record.escalationNotified))];
  const payload=v2('Department Support Ticket',text, [], false, 'assistance');
  const footer=payload.components[0].components.pop();
  payload.components[0].addSeparatorComponents(new D.SeparatorBuilder()).addActionRowComponents(new D.ActionRowBuilder().addComponents(...controls));
  payload.components[0].components.push(footer);
  return payload;
}
module.exports={NOTICE_VERSION,caseNotice,ticketNotice};
