const D = require('discord.js');
const pack = require('../assets/emojis/pack.json');
const { v2 } = require('./panels');
const running = new Set();
async function install(context, progress = async () => {}) {
  const { guild, user } = context;
  const member = await guild.members.fetch({ user: user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to install server emojis.');
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(D.PermissionFlagsBits.CreateGuildExpressions)) throw new Error('Give the bot Create Expressions permission to upload server emojis.');
  if (running.has(guild.id)) throw new Error('An emoji operation is already running in this server.');
  running.add(guild.id);
  const added = [], skipped = [], failed = [];
  try {
    const existing = await guild.emojis.fetch();
    const names = new Set(existing.map(e => e.name));
    await progress('Installing the Valenti emoji pack. Discord may take a while to process emoji uploads.');
    for (const [name, data] of Object.entries(pack)) {
      if (names.has(name)) { skipped.push(name); continue; }
      try {
        const emoji = await guild.emojis.create({ attachment: Buffer.from(data, 'base64'), name, reason: `Valenti emoji pack requested by ${user.id}` });
        added.push(`<:${name}:${emoji.id}>`); names.add(name);
      } catch (e) {
        const reason = e.code === 30008 ? 'Server emoji slots are full.' : e.code === 50013 ? 'Bot permission was denied.' : `Discord upload failed (${e.code || e.name}).`;
        failed.push(`${name}: ${reason}`);
        // Stop on errors: avoids a burst of failing requests and is safe to rerun.
        break;
      }
    }
    return `**Added:** ${added.length} • **Already installed:** ${skipped.length}\n\n${added.slice(0,20).join(' ')}${added.length>20 ? `\n…and ${added.length-20} more added.` : ''}${failed.length ? `\n\n${failed.join('\n')} Run the command again after fixing this to add the remaining emojis.` : '\n\nThe pack is ready. Find it by typing :valenti_ in Discord.'}`;
  } finally { running.delete(guild.id); }
}
async function slash(i) {
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  const result = await install(i, text => i.editReply(v2('Installing Emojis', text, [], true)));
  await i.editReply(v2('Server Emoji Pack', result, [], true));
}
async function prefix(context) {
  let status;
  const result = await install(context, async text => { status = await context.channel.send(v2('Installing Emojis', text)); });
  await status.edit(v2('Server Emoji Pack', result));
}
async function remove(context, progress = async () => {}) {
  const { guild, user } = context;
  const member = await guild.members.fetch({ user: user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to remove server emojis.');
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(D.PermissionFlagsBits.CreateGuildExpressions) && !me.permissions.has(D.PermissionFlagsBits.ManageGuildExpressions)) throw new Error('The bot needs Create Expressions or Manage Expressions permission.');
  if (running.has(guild.id)) throw new Error('An emoji operation is already running in this server.');
  running.add(guild.id);
  let deleted = 0, skipped = 0, failure = '';
  try {
    const emojis = await guild.emojis.fetch();
    await progress('Removing Valenti pack emojis created by this bot. Other emojis will be kept.');
    for (const emoji of emojis.values()) {
      if (!Object.hasOwn(pack, emoji.name) || emoji.managed) continue;
      // Missing ownership data is not permission to delete a name match.
      if (!emoji.author?.id || emoji.author.id !== me.id) { skipped++; continue; }
      try { await emoji.delete(`Valenti emoji pack removal requested by ${user.id}`); deleted++; }
      catch (e) {
        if (e.code === 10014) continue; // Already removed elsewhere.
        failure = e.code === 50013 ? 'Discord denied permission to delete an emoji.' : `Discord deletion failed (${e.code || e.name}).`;
        break;
      }
    }
    return `**Deleted:** ${deleted} • **Kept because ownership did not match or could not be verified:** ${skipped}\n\n${failure ? `${failure} Fix the issue and rerun to continue.` : 'Finished. Other server emojis were left alone.'}`;
  } finally { running.delete(guild.id); }
}
async function removePrefix(context) {
  let status;
  const result = await remove(context, async text => { status = await context.channel.send(v2('Removing Emojis', text)); });
  await status.edit(v2('Emoji Removal', result));
}
module.exports = { install, slash, prefix, remove, removePrefix };
