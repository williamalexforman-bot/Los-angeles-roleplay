const D = require('discord.js');
const E = require('./panel-emojis');
const { decorate } = require('./branding');
const { TICKETS } = require('./settings');
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
  if(type !== 'ticket') throw new Error('Infraction and promotion launcher panels are not used.');
  const emojis = { general: '❓', affairs: '📋', high: '🛡️' };
  const box = new D.ContainerBuilder().setAccentColor(0x342080)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('## '+E.heading('PCSO Tickets')+'\nIf you want to open a ticket in our server please select one of the following options based off of what they are meant to be used for.'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(E.icon('support','❓')+' **General Support**\n\n• General questions you have.\n• Questions on how we work.'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(E.icon('internal_affairs','📋')+' **OPS Reports**\n\n• Report a member of our department.\n• Questions that lower ranks cannot answer.'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(E.icon('high_rank','🛡️')+' **Administrative**\n\n• Reports on an HR member.\n• Raid threat reports.\n• SOS.\n• Anything that requires immediate attention.'))
    .addActionRowComponents(row(new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Select the correct support category').addOptions(Object.entries(TICKETS).map(([value,label])=>({label,value,emoji:E.component({general:'support',affairs:'internal_affairs',high:'high_rank'}[value],{name:emojis[value]})})))));
  decorate(box, 'assistance');
  return { components: [box], flags: D.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}
function section(icon, title, text) { return `${E.icon(icon,'•')} **${title}**\n${text}`; }
module.exports = { row, button, v2, panel, section };
