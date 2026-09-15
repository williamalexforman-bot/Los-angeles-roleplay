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
  return v2('🎫 Valenti Crime Family Support', [
    'Welcome to the Valenti Crime Family support system. Select the option that best matches what you need.',
    '', '### 🎫 General Support', '> General questions • Server information • Normal assistance',
    '### 📋 Internal Affairs', '> Reports against staff or other members • Internal complaints',
    '### ⭐ High Rank', '> Leadership concerns • High-rank matters', '', '*Realism at its Finest*',
  ].join('\n'), [new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Select the correct support category').addOptions(Object.entries(TICKETS).map(([value,label])=>({label,value})))]);
}
module.exports = { row, button, v2, panel };
