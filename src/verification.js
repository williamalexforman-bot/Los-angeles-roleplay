const D = require('discord.js');
const store = require('./store');
const { v2, button, row } = require('./panels');
const { lookupUsername } = require('./roblox');
const CHANNEL_ID = '1538390763476357130';
const BUTTON_ID = 'verification:start';
const MODAL_ID = 'verification:username';

function panel() {
  return v2('Roblox Verification', 'Press **Verify** and enter your Roblox username. We will check that the account exists and update your server nickname to its Roblox username.', [button(BUTTON_ID, 'Verify', D.ButtonStyle.Success)]);
}

function isPanel(message, botId) {
  if (message.author?.id !== botId) return false;
  const hasButton = component => component.custom_id === BUTTON_ID || component.customId === BUTTON_ID || (component.components || []).some(hasButton);
  return (message.components || []).some(c => hasButton(c.toJSON ? c.toJSON() : c));
}

async function ensurePanel(client) {
  try {
   const channel = await client.channels.fetch(CHANNEL_ID);
   if (!channel || channel.type !== D.ChannelType.GuildText || channel.guildId !== (process.env.GUILD_ID?.trim() || '1538371050759520306')) throw new Error('Verification channel is unavailable in the configured server.');
   return await store.locked(`verification-panel:${CHANNEL_ID}`, async () => {
    const panels = store.collection('verification_panels');
    const saved = await panels.findOne({ _id: CHANNEL_ID });
    if (saved?.messageId) {
      const existing = await channel.messages.fetch(saved.messageId).catch(e => { if (e.code === 10008) return null; throw e; });
      if (existing && isPanel(existing, client.user.id)) return existing;
    }
    // Recover a send that succeeded before its database write completed.
    const recent = await channel.messages.fetch({ limit: 100 });
    let message = recent.find(m => isPanel(m, client.user.id));
    if (!message) message = await channel.send({ ...panel(), nonce: CHANNEL_ID, enforceNonce: true });
    await panels.updateOne({ _id: CHANNEL_ID }, { $set: { messageId: message.id, guildId: channel.guildId } }, { upsert: true });
    console.log('Verification panel ready:', message.id);
    return message;
   });
  } catch (error) {
    if ([50001, 50013].includes(error.code)) throw new Error(`I cannot access or post the verification panel in <#${CHANNEL_ID}>. Give me View Channel, Read Message History, Send Messages and Embed Links there, including its channel overrides.`);
    if (error.code === 10003) throw new Error(`Verification channel ${CHANNEL_ID} no longer exists or is unavailable to this bot.`);
    if (error.code === 50035) {
      console.error('Verification panel rejected:', JSON.stringify(error.rawError?.errors || {}));
      throw new Error('Discord rejected the verification panel format (50035). Check that Render deployed the latest version; validation details are in the bot logs.');
    }
    throw error;
  }
}

async function handle(i, request = fetch) {
  if (!i.inGuild() || i.channelId !== CHANNEL_ID) throw new Error('Use the verification panel in the verification channel.');
  if (i.isButton() && i.customId === BUTTON_ID) {
    return i.showModal(new D.ModalBuilder().setCustomId(MODAL_ID).setTitle('Roblox Verification').addComponents(row(
      new D.TextInputBuilder().setCustomId('roblox').setLabel('Roblox username (not display name)').setStyle(D.TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(20)
    )));
  }
  if (!i.isModalSubmit() || i.customId !== MODAL_ID) return;
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  const account = await lookupUsername(i.fields.getTextInputValue('roblox'), request);
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (member.nickname !== account.name) {
    const me = await i.guild.members.fetchMe();
    if (!me.permissions.has(D.PermissionFlagsBits.ManageNicknames) || !member.manageable) throw new Error('I cannot change your nickname. Staff must give me Manage Nicknames and place my role above yours. Discord does not allow me to rename the server owner.');
    await member.setNickname(account.name, 'Member requested Roblox username sync');
  }
  await i.editReply(v2('Roblox Username Synced', `Your server nickname is now **${D.escapeMarkdown(account.name)}**.\n[View Roblox profile](https://www.roblox.com/users/${account.id}/profile)`, [], true));
}
module.exports = { CHANNEL_ID, BUTTON_ID, MODAL_ID, panel, isPanel, ensurePanel, handle };
