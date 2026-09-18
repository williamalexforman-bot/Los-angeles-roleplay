const D = require('discord.js');
const pack = require('../assets/emojis/pack.json');
const { v2 } = require('./panels');
const running = new Map();
function begin(guildId, kind, force = false) {
  const previous = running.get(guildId);
  if (previous && !force) throw new Error('An emoji operation is already running in this server.');
  if (previous) previous.cancelled = true;
  let finish;
  const op = { kind, cancelled: false, previous: previous?.done, done: new Promise(resolve => { finish = resolve; }) };
  op.finish = () => { if (running.get(guildId) === op) running.delete(guildId); finish(); };
  running.set(guildId, op);
  return op;
}
const jobs = new Map();
function progressText(job) {
  return `**Installed:** ${job.done}/${Object.keys(pack).length} • **Added this run:** ${job.added}\n${job.current ? `Processing: ${job.current}` : "Checking existing emojis…"}\nLast completed upload: ${Math.floor((Date.now()-job.last)/1000)} seconds ago. Discord can delay emoji uploads while rate-limited; the queue remains active.`;
}
async function install(context, progress = async () => {}) {
  const { guild, user } = context;
  const member = await guild.members.fetch({ user: user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to install server emojis.');
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(D.PermissionFlagsBits.CreateGuildExpressions)) throw new Error('Give the bot Create Expressions permission to upload server emojis.');
  const op = begin(guild.id, 'install');
  const added = [], skipped = [], failed = [];
  const job = { done: 0, added: 0, current: '', last: Date.now() };
  jobs.set(guild.id, job);
  let reporting = false, timer, reportTask;
  const report = async () => {
    if (reporting) return;
    reporting = true;
    try { await progress(progressText(job)); }
    catch (e) { console.error('Emoji progress update failed:', e.code || e.name); }
    finally { reporting = false; }
  };
  try {
    const existing = await guild.emojis.fetch();
    const names = new Set(existing.map(e => e.name));
    job.done = Object.keys(pack).filter(name => names.has(name)).length;
    await report();
    timer = setInterval(() => { if (!reporting) reportTask = report(); }, 15000);
    timer.unref();
    for (const [name, data] of Object.entries(pack)) {
      if (op.cancelled) break;
      if (names.has(name)) { skipped.push(name); continue; }
      job.current = name;
      try {
        const emoji = await guild.emojis.create({ attachment: Buffer.from(data, 'base64'), name, reason: `Valenti emoji pack requested by ${user.id}` });
        added.push(`<:${name}:${emoji.id}>`); names.add(name);
        job.done++; job.added++; job.last = Date.now();
      } catch (e) {
        const reason = e.code === 30008 ? 'Server emoji slots are full.' : e.code === 50013 ? 'Bot permission was denied.' : `Discord upload failed (${e.code || e.name}).`;
        failed.push(`${name}: ${reason}`);
        // Stop on errors: avoids a burst of failing requests and is safe to rerun.
        break;
      }
    }
    if (op.cancelled) return `Installation stopped. Added ${added.length} emojis before stopping.`;
    return `**Added:** ${added.length} • **Already installed:** ${skipped.length}\n\n${added.slice(0,20).join(' ')}${added.length>20 ? `\n…and ${added.length-20} more added.` : ''}${failed.length ? `\n\n${failed.join('\n')} Run -continue emojis after fixing this to add the remaining emojis.` : '\n\nThe pack is ready. Find it by typing :valenti_ in Discord.'}`;
  } finally { clearInterval(timer); await reportTask; jobs.delete(guild.id); op.finish(); }
}
async function slash(i) {
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  const result = await install(i, text => i.editReply(v2('Installing Emojis', text, [], true)));
  await i.editReply(v2('Server Emoji Pack', result, [], true));
}
async function prefix(context) {
  let status;
  const result = await install(context, async text => {
    if (status) await status.edit(v2('Installing Emojis', text));
    else status = await context.channel.send(v2('Installing Emojis', text));
  });
  if (status) await status.edit(v2('Server Emoji Pack', result));
  else await context.channel.send(v2('Server Emoji Pack', result));
}
async function remove(context, progress = async () => {}, force = false) {
  const { guild, user } = context;
  const member = await guild.members.fetch({ user: user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to remove server emojis.');
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(D.PermissionFlagsBits.CreateGuildExpressions) && !me.permissions.has(D.PermissionFlagsBits.ManageGuildExpressions)) throw new Error('The bot needs Create Expressions or Manage Expressions permission.');
  const op = begin(guild.id, 'remove', force);
  let deleted = 0, skipped = 0, failure = '';
  try {
    if (op.previous) {
      await progress('Previous emoji operation cancelled. Waiting for its pending Discord request before restarting deletion.');
      await op.previous;
    }
    if (op.cancelled) return 'Deletion stopped before restarting.';
    const emojis = await guild.emojis.fetch();
    await progress('Removing Valenti pack emojis created by this bot. Other emojis will be kept.');
    for (const emoji of emojis.values()) {
      if (op.cancelled) break;
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
    return `**Deleted:** ${deleted} • **Kept because ownership did not match or could not be verified:** ${skipped}\n\n${op.cancelled ? 'Deletion stopped. A pending Discord request may have completed before stopping.' : failure ? `${failure} Fix the issue and rerun to continue.` : 'Finished. Other server emojis were left alone.'}`;
  } finally { await op.previous; op.finish(); }
}
async function removePrefix(context, force = false) {
  let status;
  const result = await remove(context, async text => {
    if (status) await status.edit(v2('Removing Emojis', text));
    else status = await context.channel.send(v2('Removing Emojis', text));
  }, force);
  await status.edit(v2('Emoji Removal', result));
}
async function continuePrefix(context) {
  const member = await context.guild.members.fetch({ user: context.user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to continue emoji installation.');
  const job = jobs.get(context.guild.id);
  if (job) {
    await context.channel.send(v2('Emoji Installation Still Running', progressText(job) + '\nNo second upload has been started. This queue will continue when Discord permits it.'));
    return;
  }
  // Fetching current server emojis inside install also resumes safely after a restart.
  return prefix(context);
}
async function stopDeleting(context) {
  const member = await context.guild.members.fetch({ user: context.user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to stop emoji deletion.');
  const op = running.get(context.guild.id);
  if (!op || op.kind !== 'remove') return 'No emoji deletion is running.';
  op.cancelled = true;
  return 'Deletion stop requested. No further deletes will be started; a request already sent to Discord may still finish.';
}
module.exports = { install, slash, prefix, remove, removePrefix, continuePrefix, stopDeleting };
