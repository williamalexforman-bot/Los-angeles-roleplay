const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { openedTicketPanel, panelBuilders } = require('./panels');

const ticketLabels = {
  'general-support': 'General Support',
  'internal-affairs': 'Internal Affairs',
  'high-rank': 'High Rank',
};

function safeChannelName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function handleConfig(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the Manage Server permission to use `/config`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const panelName = interaction.options.getString('panel', true);
  const channel = interaction.options.getChannel('channel', true);
  const buildPanel = panelBuilders[panelName];

  if (!buildPanel || !channel.isTextBased()) {
    await interaction.reply({ content: 'That panel or channel is not supported.', flags: MessageFlags.Ephemeral });
    return;
  }

  await channel.send(buildPanel());
  await interaction.reply({ content: `The **${panelName}** panel was posted in ${channel}.`, flags: MessageFlags.Ephemeral });
}

async function createTicket(interaction) {
  const ticketType = interaction.values[0];
  const typeLabel = ticketLabels[ticketType];
  if (!typeLabel) return interaction.reply({ content: 'That ticket type is invalid.', flags: MessageFlags.Ephemeral });

  const existing = interaction.guild.channels.cache.find((channel) => channel.topic === `ticket-owner:${interaction.user.id}`);
  if (existing) {
    await interaction.reply({ content: `You already have an open ticket: ${existing}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const botMember = interaction.guild.members.me;
  const channel = await interaction.guild.channels.create({
    name: safeChannelName(`${ticketType}-${interaction.user.username}`),
    type: ChannelType.GuildText,
    parent: interaction.channel.parentId || undefined,
    topic: `ticket-owner:${interaction.user.id}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
      },
      ...(botMember ? [{ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }] : []),
    ],
  });

  await channel.send(openedTicketPanel(typeLabel, `${interaction.user}`));
  await interaction.editReply(`Your **${typeLabel}** ticket is ready: ${channel}`);
}

async function closeTicket(interaction) {
  const ownerId = interaction.channel.topic?.match(/^ticket-owner:(\d+)$/)?.[1];
  const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (!ownerId || (interaction.user.id !== ownerId && !canManage)) {
    await interaction.reply({ content: 'Only the ticket owner or staff with Manage Channels can close this ticket.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: 'Closing this ticket…' });
  setTimeout(() => interaction.channel.delete('Ticket closed').catch(console.error), 2000);
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'config') return await handleConfig(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create') return await createTicket(interaction);
    if (interaction.isButton() && interaction.customId === 'ticket:close') return await closeTicket(interaction);
  } catch (error) {
    console.error('Interaction failed:', error);
    const payload = { content: 'Something went wrong while completing that action.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

module.exports = { handleInteraction };
