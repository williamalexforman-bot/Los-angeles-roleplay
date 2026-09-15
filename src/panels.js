const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const COLOR = 0x247bf1;

function container(title, description) {
  return new ContainerBuilder()
    .setAccentColor(COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}`),
      new TextDisplayBuilder().setContent(description),
    );
}

function infractionPanel() {
  const panel = container(
    'Infraction Management',
    'Use this panel to access the California State Roleplay infraction system. Staff actions must follow the server handbook and punishment guidelines.',
  ).addSeparatorComponents(new SeparatorBuilder());

  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('### Staff Notice\nOnly authorized staff members may issue, view, or revoke infractions.'),
  );

  return { components: [panel], flags: MessageFlags.IsComponentsV2 };
}

function promotionPanel() {
  const panel = container(
    'Promotion Management',
    'Use this panel to access the California State Roleplay promotion system. All promotions must be authorized and accurately documented.',
  ).addSeparatorComponents(new SeparatorBuilder());

  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('### Management Notice\nOnly authorized management members may issue or revoke promotions.'),
  );

  return { components: [panel], flags: MessageFlags.IsComponentsV2 };
}

function ticketPanel() {
  const panel = container(
    'Support Center',
    'Select the department that best matches your request. Please choose only one option and explain your reason clearly after the ticket opens.',
  ).addSeparatorComponents(new SeparatorBuilder());

  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ticket:create')
        .setPlaceholder('Choose a ticket department')
        .addOptions(
          { label: 'General Support', value: 'general-support', description: 'Questions and general server assistance', emoji: '🎫' },
          { label: 'Internal Affairs', value: 'internal-affairs', description: 'Confidential reports involving staff', emoji: '🛡️' },
          { label: 'High Rank', value: 'high-rank', description: 'Requests requiring high-rank assistance', emoji: '⭐' },
        ),
    ),
  );

  return { components: [panel], flags: MessageFlags.IsComponentsV2 };
}

function openedTicketPanel(typeLabel, userMention) {
  const panel = container(
    `${typeLabel} Ticket`,
    `Welcome ${userMention}. A staff member will assist you as soon as possible. Explain your request and include any relevant evidence or details.`,
  ).addSeparatorComponents(new SeparatorBuilder());

  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
    ),
  );

  return { components: [panel], flags: MessageFlags.IsComponentsV2 };
}

const panelBuilders = { infraction: infractionPanel, promotion: promotionPanel, ticket: ticketPanel };

module.exports = { openedTicketPanel, panelBuilders };
