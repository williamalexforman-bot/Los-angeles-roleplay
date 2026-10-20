import 'dotenv/config';
import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

const token = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  throw new Error('Missing BOT_TOKEN (or DISCORD_TOKEN) and CLIENT_ID (or DISCORD_CLIENT_ID) environment variables.');
}

const sayCommand = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the department bot send a message in this channel.')
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('The message the bot should send.')
      .setRequired(true)
      .setMaxLength(2000),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(token);

client.once(Events.ClientReady, async readyClient => {
  try {
    const commands = [sayCommand.toJSON()];
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`Registered /say for guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Registered /say globally. Global command updates can take a little while to appear.');
    }
  } catch (error) {
    console.error('Failed to register /say:', error);
  }

  console.log(`Department bot online as ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'say') return;

  const message = interaction.options.getString('message', true);
  if (!interaction.inGuild() || !interaction.channel?.isSendable()) {
    await interaction.reply({ content: 'Use this command in a server text channel.', ephemeral: true });
    return;
  }

  try {
    await interaction.channel.send({
      content: message,
      allowedMentions: { parse: [] },
    });
    await interaction.reply({ content: 'Message sent.', ephemeral: true });
  } catch (error) {
    console.error('Failed to send /say message:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'I could not send that message. Check my channel permissions.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'I could not send that message. Check my channel permissions.', ephemeral: true });
    }
  }
});

client.on('error', error => console.error('Discord client error:', error));

client.login(token).catch(error => {
  console.error('Discord login failed:', error);
  process.exitCode = 1;
});
