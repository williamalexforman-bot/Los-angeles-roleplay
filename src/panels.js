const D = require('discord.js');
const E = require('./panel-emojis');
const { decorate } = require('./branding');
const { TICKETS, TICKET_DESCRIPTIONS } = require('./settings');
function row(component) { return new D.ActionRowBuilder().addComponents(component); }
function button(id, label, style = D.ButtonStyle.Primary) { const b = new D.ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style); const emoji=E.component(E.key(label)); if(emoji)b.setEmoji(emoji); return b; }
function v2(title, body, controls = [], ephemeral = false, header) {
  const box = new D.ContainerBuilder().setAccentColor(0x342080)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`## ${E.heading(title)}`))
    .addSeparatorComponents(new D.SeparatorBuilder());
  const sections=Array.isArray(body)?body:[body || ' '];
  sections.forEach((section,index)=>{
    if(index)box.addSeparatorComponents(new D.SeparatorBuilder());
    box.addTextDisplayComponents(new D.TextDisplayBuilder().setContent(section));
  });
  for (const control of controls) box.addActionRowComponents(row(control));
  decorate(box, header);
  return { components: [box], flags: D.MessageFlags.IsComponentsV2 | (ephemeral ? D.MessageFlags.Ephemeral : 0), allowedMentions: { parse: [] } };
}
function panel(type) {
  if(type!=='ticket')throw new Error('Only the ticket panel is available.');
  const icons={general:'support',affairs:'internal_affairs',division:'staff',high:'high_rank',recruitment:'member'};
  const box=new D.ContainerBuilder().setAccentColor(0x342080)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('## '+E.heading('Support Tickets')+'\nSelect the department that best matches your request.'));
  for(const [key,label] of Object.entries(TICKETS))box.addSeparatorComponents(new D.SeparatorBuilder()).addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`${E.icon(icons[key],'•')} **${label}**\n${TICKET_DESCRIPTIONS[key]}`));
  box.addActionRowComponents(row(new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Choose a support department').addOptions(Object.entries(TICKETS).map(([value,label])=>({label,value,description:TICKET_DESCRIPTIONS[value],emoji:E.component(icons[value],{name:'🎫'})})))));
  return {components:[box],flags:D.MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
function section(icon, title, text) { return `${E.icon(icon,'•')} **${title}**\n${text}`; }
module.exports = { row, button, v2, panel, section };
