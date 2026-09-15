const D = require('discord.js');
const { TICKETS } = require('./settings');
function row(component) { return new D.ActionRowBuilder().addComponents(component); }
function button(id, label, style = D.ButtonStyle.Primary) { return new D.ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style); }
function v2(title, body, controls = [], ephemeral = false) {
  const box = new D.ContainerBuilder().setAccentColor(0x247bf1)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(body || ' '));
  for (const control of controls) box.addActionRowComponents(row(control));
  return { components: [box], flags: D.MessageFlags.IsComponentsV2 | (ephemeral ? D.MessageFlags.Ephemeral : 0), allowedMentions: { parse: [] } };
}
function panel(type) {
  if(type !== 'ticket') throw new Error('Infraction and promotion launcher panels are not used.');
  const emojis = { general: '1549472622365114448', affairs: '1549472948002230393', high: '1549472448624464043' };
  const box = new D.ContainerBuilder().setAccentColor(0x247bf1)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('## Valenti Tickets\nIf you want to open a ticket in our server please select one of the following options based off of what they are meant to be used for.'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('# General Support <:general_support:1549472622365114448>\n\n> General Questions you have.\n>\n> Questions on how we work.'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('# Internal Affairs <:internal_affairs:1549472948002230393>\n\n> Report a member of our Mafia\n>\n> Questions that lower ranks cannot answer.'))
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('# Senior High Rank <:senior_high_rank:1549472448624464043>\n\n> Reports on an HR member.\n>\n> Raid Threat report\n>\n> SOS\n>\n> Anything that requires Immediate attention'))
    .addActionRowComponents(row(new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Select the correct support category').addOptions(Object.entries(TICKETS).map(([value,label])=>({label,value,emoji:{id:emojis[value]}})))));
  return { components: [box], flags: D.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}
module.exports = { row, button, v2, panel };
