const D = require('discord.js');
function emojiError(e) {
  return e.code === 10014 || (e.code === 50035 && /emoji/i.test(JSON.stringify(e.rawError?.errors || e.errors || e.message || '')));
}
function withoutEmojis(payload) {
  const components = payload.components.map(c => c.toJSON ? c.toJSON() : structuredClone(c));
  function walk(c) {
    delete c.emoji;
    for (const child of c.components || []) walk(child);
    for (const option of c.options || []) delete option.emoji;
  }
  components.forEach(walk);
  return { ...payload, components };
}
async function sendPanel(channel, guild, payload) {
  if (!channel?.send || !channel.isTextBased?.()) throw new Error('Choose a text channel where the bot can post the panel.');
  if (channel.guildId !== guild.id) throw new Error('Choose a channel in this server.');
  const me = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  const required = [[D.PermissionFlagsBits.ViewChannel,'View Channel'], [channel.isThread?.() ? D.PermissionFlagsBits.SendMessagesInThreads : D.PermissionFlagsBits.SendMessages,'Send Messages'], [D.PermissionFlagsBits.EmbedLinks,'Embed Links']];
  const missing = required.filter(([flag])=>!permissions?.has(flag)).map(([,name])=>name);
  if (missing.length) throw new Error(`The bot needs ${missing.join(', ')} in <#${channel.id}> to post this panel.`);
  try { return await channel.send(payload); }
  catch(e) {
    if (!emojiError(e)) throw e;
    // Discord rejected the first payload, so a single emoji-free retry cannot duplicate it.
    return channel.send(withoutEmojis(payload));
  }
}
function describeError(e) {
  const messages = {
    50013:'Discord denied permission for this action. Check the bot’s permissions in the selected channel.',
    50001:'The bot cannot access the selected server or channel.',
    10003:'That channel no longer exists. Select another channel.',
    10014:'Discord rejected a custom emoji. Refresh the emoji pack and try again.',
    10062:'This interaction expired. Run the command again.',
    50035:'Discord rejected part of this panel or command data. Share the error code and reference below so the invalid field can be checked.',
  };
  if (messages[e.code]) return `${messages[e.code]} (Code: ${e.code})`;
  if (e.name === 'Error') return e.message;
  return `The action failed (${String(e.code || e.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}). Share the reference below; this is not necessarily a permissions issue.`;
}
function errorFields(e) {
  const paths=[];
  function walk(value,path='') {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value._errors)) paths.push(path);
    for (const [k,v] of Object.entries(value)) if (k!=='_errors') walk(v,path ? `${path}.${k}` : k);
  }
  walk(e.rawError?.errors || e.errors);
  return paths.slice(0,20);
}
module.exports={sendPanel,withoutEmojis,describeError,errorFields};
