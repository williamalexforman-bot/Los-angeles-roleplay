const D = require('discord.js');
const pack = require('../assets/emojis/pack.json');
const { staticLimit, staticUsed } = require('./emoji-capacity');
const { v2 } = require('./panels');
const BATCH_SIZE = 5;
const running = new Map();
function begin(guildId, kind, force = false) {
  const previous = running.get(guildId);
  if (previous && !force) throw new Error('An emoji operation is already running in this server.');
  if (previous) previous.cancelled = true;
  let finish;
  const op = { kind, cancelled: false, previousOp: previous, previous: previous?.done, done: new Promise(resolve => { finish = resolve; }) };
  op.finish = () => { if (running.get(guildId) === op) running.delete(guildId); finish(); };
  running.set(guildId, op);
  return op;
}
const jobs = new Map();
function cooldown(e) {
  if (e.name !== 'RateLimitError') return null;
  const seconds = Math.max(1, Math.ceil((e.retryAfter || e.timeToReset || 1000)/1000));
  return `Discord paused emoji requests. Wait at least ${seconds} seconds, then run -continue emojis to add more (or rerun your deletion command). The current job has stopped; no requests are being retried by this job.`;
}
function progressText(job) {
  return `**Installed:** ${job.done}/${Object.keys(pack).length} • **Batch progress:** ${job.added}/${BATCH_SIZE}\n${job.current ? `Processing: ${job.current}` : "Checking existing emojis…"}\n${job.capacity || ""}\nLast completed upload: ${Math.floor((Date.now()-job.last)/1000)} seconds ago. Discord can delay emoji uploads while rate-limited; the queue remains active.`;
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
    if (guild.fetch) await guild.fetch();
    const existing = await guild.emojis.fetch();
    const limit = staticLimit(guild);
    let used = staticUsed(existing), full = false;
    const names = new Set(existing.map(e => e.name));
    const alreadyInstalled = Object.keys(pack).filter(name => names.has(name)).length;
    job.done = alreadyInstalled;
    job.capacity = `Static emoji slots: ${used}/${limit}`;
    await report();
    timer = setInterval(() => { if (!reporting) reportTask = report(); }, 15000);
    timer.unref();
    for (const [name, data] of Object.entries(pack)) {
      if (op.cancelled) break;
      if (names.has(name)) { skipped.push(name); continue; }
      // Include current gateway cache changes, plus uploads confirmed during this run.
      used = Math.max(used, guild.emojis.cache ? staticUsed(guild.emojis.cache) : 0);
      if (used >= staticLimit(guild)) { full = true; break; }
      if (added.length >= BATCH_SIZE) break;
      job.current = name;
      try {
        const emoji = await guild.emojis.create({ attachment: Buffer.from(data, 'base64'), name, reason: `Valenti emoji pack requested by ${user.id}` });
        added.push(`<:${name}:${emoji.id}>`); names.add(name);
        job.done++; job.added++; job.last = Date.now();
        used++; job.capacity = `Static emoji slots: ${used}/${staticLimit(guild)}`;
      } catch (e) {
        if (e.code === 30008) { full = true; break; }
        if (cooldown(e)) { failed.push(cooldown(e)); break; }
        const reason = e.code === 30008 ? 'Server emoji slots are full.' : e.code === 50013 ? 'Bot permission was denied.' : `Discord upload failed (${e.code || e.name}).`;
        failed.push(`${name}: ${reason}`);
        // Stop on errors: avoids a burst of failing requests and is safe to rerun.
        break;
      }
    }
    if (op.cancelled) return `Installation stopped. Added ${added.length} emojis before stopping.`;
    const remaining = Object.keys(pack).filter(name => !names.has(name)).length;
    if (full) return `**Server emoji limit reached.**\nAdded: ${added.length} • Pack installed: ${job.done}/${Object.keys(pack).length} • Not added: ${remaining}\nStatic slots: ${used}/${staticLimit(guild)}. Uploads have stopped. Free up static emoji slots before running -continue emojis.`;
    return `**Added:** ${added.length} • **Already installed:** ${alreadyInstalled}\n\n${added.slice(0,20).join(' ')}${added.length>20 ? `\n…and ${added.length-20} more added.` : ''}${failed.length ? `\n\n${failed.join('\n')} Run -continue emojis after fixing this to add the remaining emojis.` : remaining ? `\n\nBatch complete. **${remaining} emojis remaining.** Run -continue emojis to install the next ${BATCH_SIZE}.` : '\n\nThe pack is ready. Find it by typing :valenti_ in Discord.'}`;
  } catch(e) { if(cooldown(e))return cooldown(e); throw e; } finally { clearInterval(timer); await reportTask; jobs.delete(guild.id); op.finish(); }
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
        failure = cooldown(e) || (e.code === 50013 ? 'Discord denied permission to delete an emoji.' : `Discord deletion failed (${e.code || e.name}).`);
        break;
      }
    }
    return `**Deleted:** ${deleted} • **Kept because ownership did not match or could not be verified:** ${skipped}\n\n${op.cancelled ? 'Deletion stopped. A pending Discord request may have completed before stopping.' : failure ? `${failure} Fix the issue and rerun to continue.` : 'Finished. Other server emojis were left alone.'}`;
  } catch(e) { if(cooldown(e))return cooldown(e); throw e; } finally { await op.previous; op.finish(); }
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
async function forceStop(context) {
  const member = await context.guild.members.fetch({ user: context.user.id, force: true });
  if (!member.permissions.has(D.PermissionFlagsBits.Administrator)) throw new Error('Administrator permission is required to force stop emoji jobs.');
  let op = running.get(context.guild.id);
  if (!op) return 'No emoji job is running. You can use -continue emojis to start the next batch.';
  while (op) { op.cancelled = true; op = op.previousOp; }
  return 'All current and queued emoji jobs have been cancelled. No further uploads or deletes will start from those jobs. A request already sent to Discord may still finish; the lock is released when it settles. Discord cooldowns still apply.';
}
module.exports = { forceStop, install, slash, prefix, remove, removePrefix, continuePrefix, stopDeleting };
