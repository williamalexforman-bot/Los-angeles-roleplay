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
  if (type === 'ticket') return v2('California State Roleplay • Support', 'Choose a department below. You will be asked for a reason before a private ticket is created.', [new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Choose a department').addOptions(Object.entries(TICKETS).map(([value, label]) => ({ label, value })))]);
  return v2(type === 'infraction' ? 'Infraction Management' : 'Promotion Management', type === 'infraction' ? 'Authorized staff can select a member, choose an infraction and provide a reason. Warning and strike totals are recorded automatically.' : 'Authorized staff can select a member, their previous rank, their new rank and a reason.', [button(`staff:${type}`, type === 'infraction' ? 'Issue Infraction' : 'Issue Promotion')]);
}
module.exports = { row, button, v2, panel };
