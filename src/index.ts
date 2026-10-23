import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from 'discord.js';

const token = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID || '1516451513680003303';
const prefix = process.env.PREFIX || '-';
const dockApiKey = process.env.DOCK_API;
const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
const unverifiedRoleId = process.env.UNVERIFIED_ROLE_ID;
const verificationLogChannelId = process.env.VERIFICATION_LOG_CHANNEL_ID || '1546571436775309492';
const verificationBannerUrl = 'https://cdn.phototourl.com/member/2026-10-23-7df6376d-8d65-4981-93f6-17436d3189ca.png';

export const guildConfig = {
  name: 'California State Roleplay',
  shortName: 'CaliRP',
  channels: {
    ticketPanel: '1546571353459794000',
    ticketLogs: '1546571291589607617',
    welcome: '1546571410070306928',
    sessions: '1546571384451366982',
    infractions: '1546571428663664810',
    promotions: '1546571427170353262',
    applicationPanel: '1546571350804660331',
    applicationResults: '1546571405230080131',
    giveaways: '1555574069359939624',
    erlcJoinLeave: '1546571444769656853',
    boostAnnouncements: '1546571364109123709',
    modLogs: '1546571436775309492',
  },
  categories: {
    ticketGeneral: '1555574910188003478',
    ticketHighRank: '1555574996561301514',
    applications: '1555575058238275725',
  },
};

if (!token || !clientId) {
  throw new Error('Missing BOT_TOKEN (or DISCORD_TOKEN) and CLIENT_ID (or DISCORD_CLIENT_ID) environment variables.');
}

const sayCommand = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the department bot send a message in this channel.')
  .addStringOption(option =>
    option.setName('message').setDescription('The message the bot should send.')
      .setRequired(true).setMaxLength(2000),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const relinkCommand = new SlashCommandBuilder()
  .setName('relink')
  .setDescription('Open Dock Systems to link or change your Roblox account.');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const rest = new REST({ version: '10' }).setToken(token);

async function getRobloxInfo(discordId: string, targetGuildId: string) {
  if (!dockApiKey) return { error: 'Verification is not configured yet. Ask an administrator to set DOCK_API.' } as const;
  try {
    const response = await fetch(
      `https://api.docksys.xyz/api/v1/public/discord-to-roblox?discordId=${encodeURIComponent(discordId)}&guildId=${encodeURIComponent(targetGuildId)}`,
      { headers: { Authorization: `Bearer ${dockApiKey}` } },
    );
    if (!response.ok) {
      console.error('Dock Systems lookup failed with HTTP', response.status);
      return { error: 'Could not check your linked account. Please try again later.' } as const;
    }
    const payload = await response.json() as { data?: { robloxId?: string | number } };
    const robloxId = payload?.data?.robloxId;
    if (!robloxId) return { error: 'No Roblox account is linked to this Discord account yet.' } as const;

    const userResponse = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(String(robloxId))}`);
    if (!userResponse.ok) return { error: 'Roblox could not be reached. Please try again later.' } as const;
    const userPayload = await userResponse.json() as { name?: string };
    if (!userPayload.name) return { error: 'Could not retrieve the Roblox username.' } as const;
    return { robloxId: String(robloxId), username: userPayload.name } as const;
  } catch (error) {
    console.error('Verification lookup failed:', error);
    return { error: 'Verification service is temporarily unavailable.' } as const;
  }
}

function containerWithText(...lines: string[]) {
  const container = new ContainerBuilder();
  for (const line of lines) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
  return container;
}

async function showVerificationPanel(message: Message) {
  if (!message.guild || !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply('You need **Manage Server** permission to post the verification panel.');
    return;
  }
  const panel = containerWithText(
    '## California State Roleplay — Verification',
    'Link your Roblox account through **Dock Systems** to receive access to the server. If you have linked the wrong account, you can change it before continuing.',
  );
  panel.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(verificationBannerUrl),
    ),
  );
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  panel.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('verification:start').setLabel('Begin Verification').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setLabel('Link / Change Roblox Account').setStyle(ButtonStyle.Link).setURL('https://docksys.xyz/account'),
    ),
  );
  const channel = message.guild.channels.cache.get(message.channelId);
  if (!channel?.isSendable()) {
    await message.reply('I cannot send the panel in this channel. Check my channel permissions.');
    return;
  }
  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [panel] });
  await message.reply({ content: 'Verification panel posted.', allowedMentions: { parse: [] } });
}

async function handleVerificationStart(interaction: import('discord.js').ButtonInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use verification inside the server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  const result = await getRobloxInfo(interaction.user.id, interaction.guildId);
  if ('error' in result) {
    const container = containerWithText(
      '## Roblox Verification',
      result.error,
      'If you have not linked an account yet, use the button below and then try verification again.',
    );
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('Link / Change Account').setStyle(ButtonStyle.Link).setURL('https://docksys.xyz/account'),
      ),
    );
    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
    return;
  }

  const profileUrl = `https://www.roblox.com/users/${result.robloxId}/profile`;
  const container = containerWithText(
    '## Roblox Verification',
    `A Roblox account is linked: **[${result.username}](${profileUrl})**. Continue to receive the server verification role, or change the linked account first.`,
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('verification:continue').setLabel('Continue').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setLabel('Change Account').setStyle(ButtonStyle.Link).setURL('https://docksys.xyz/account'),
    ),
  );
  await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
}

async function handleVerificationContinue(interaction: import('discord.js').ButtonInteraction) {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: 'Use verification inside the server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  if (!verifiedRoleId) {
    await interaction.editReply({ components: [containerWithText('## Verification Not Configured', 'An administrator must set VERIFIED_ROLE_ID before verification can finish.')] });
    return;
  }
  const result = await getRobloxInfo(interaction.user.id, interaction.guildId);
  if ('error' in result) {
    await interaction.editReply({ components: [containerWithText('## Verification Could Not Be Completed', result.error, 'If you changed accounts, click Begin Verification again.')] });
    return;
  }
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await member.roles.add(verifiedRoleId, 'Completed Roblox account verification');
    if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) {
      await member.roles.remove(unverifiedRoleId, 'Completed Roblox account verification');
    }
    const profileUrl = `https://www.roblox.com/users/${result.robloxId}/profile`;
    const success = containerWithText(
      '### Verification Successful',
      `Verified under **[${result.username}](${profileUrl})**. Welcome to California State Roleplay!`,
    );
    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [success] });

    const logChannel = await interaction.guild.channels.fetch(verificationLogChannelId).catch(() => null);
    if (logChannel?.isTextBased() && 'send' in logChannel) {
      await logChannel.send({
        content: [
          '## Roblox Account Verified',
          `**Discord:** <@${interaction.user.id}> (${interaction.user.id})`,
          `**Roblox:** [${result.username}](${profileUrl}) (${result.robloxId})`,
          `**Verified:** <t:${Math.floor(Date.now() / 1000)}:F>`,
        ].join('\n'),
        allowedMentions: { parse: [] },
      }).catch((error) => console.error('Could not send verification log:', error));
    }
  } catch (error) {
    console.error('Could not assign verification role:', error);
    await interaction.editReply({ components: [containerWithText('## Role Assignment Failed', 'I could not assign your verification role. Please contact staff and check the bot role hierarchy and permissions.')] });
  }
}

client.once(Events.ClientReady, async readyClient => {
  try {
    const commands = [sayCommand.toJSON(), relinkCommand.toJSON()];
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`Registered /say and /relink for guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Registered /say and /relink globally. Global command updates can take a little while to appear.');
    }
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
  console.log(`California State Roleplay bot online as ${readyClient.user.tag}.`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(prefix)) return;
  const [command] = message.content.slice(prefix.length).trim().split(/\s+/);
  if (command?.toLowerCase() === 'verificationpanel') {
    await showVerificationPanel(message).catch((error) => {
      console.error('Could not post verification panel:', error);
      void message.reply('Something went wrong while posting the verification panel.');
    });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'verification:start') {
      await handleVerificationStart(interaction).catch(async (error) => {
        console.error('Verification start failed:', error);
        if (interaction.deferred || interaction.replied) await interaction.editReply('Verification could not start. Please try again later.').catch(() => {});
        else await interaction.reply({ content: 'Verification could not start. Please try again later.', flags: MessageFlags.Ephemeral }).catch(() => {});
      });
      return;
    }
    if (interaction.customId === 'verification:continue') {
      await handleVerificationContinue(interaction).catch(async (error) => {
        console.error('Verification continuation failed:', error);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ components: [containerWithText('## Verification Error', 'Verification could not be completed. Please contact staff.')] }).catch(() => {});
        else await interaction.reply({ content: 'Verification could not be completed. Please contact staff.', flags: MessageFlags.Ephemeral }).catch(() => {});
      });
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'relink') {
    await interaction.reply({
      content: 'Use Dock Systems to link or change the Roblox account connected to your Discord: https://docksys.xyz/account',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (interaction.commandName !== 'say') return;

  const message = interaction.options.getString('message', true);
  if (!interaction.inGuild() || !interaction.channel?.isSendable()) {
    await interaction.reply({ content: 'Use this command in a server text channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    await interaction.channel.send({ content: message, allowedMentions: { parse: [] } });
    await interaction.reply({ content: 'Message sent.', flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Failed to send /say message:', error);
    const reply = { content: 'I could not send that message. Check my channel permissions.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
});

client.on('error', error => console.error('Discord client error:', error));
client.login(token).catch(error => {
  console.error('Discord login failed:', error);
  process.exitCode = 1;
});
