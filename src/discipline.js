const D = require('discord.js');
const { collection, locked } = require('./store');
const { CHANNELS, ROLES, TYPES } = require('./settings');
const { caseNotice } = require('./legacy-layout');
const { v2 } = require('./panels');
async function settings(guildId) { return { ...CHANNELS, ...(await collection('config').findOne({ _id: guildId })) }; }
async function destination(guild, key) {
  const config = await settings(guild.id);
  const channel = await guild.channels.fetch(config[key]);
  if (!channel?.isTextBased() || !channel.send) throw new Error(`Configure a text channel for ${key}.`);
  const me = guild.members.me || await guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([D.PermissionFlagsBits.ViewChannel, D.PermissionFlagsBits.SendMessages])) throw new Error(`The bot cannot send messages in ${key}.`);
  return channel;
}
function advance(state, type) {
  let warnings = state.warnings || 0, strikes = state.strikes || 0;
  if (type === 'Warning') { warnings++; if (warnings >= 3) { warnings = 0; strikes++; } }
  if (type === 'Strike') strikes++;
  return { warnings, strikes, suspend: type === 'Suspension' || (strikes >= 3 && strikes > (state.strikes || 0)) };
}
function endDate(input) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) throw new Error('Use YYYY-MM-DD HH:mm in UTC for the suspension end date.');
  const n = Date.parse(input.replace(' ', 'T') + ':00Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,16).replace('T',' ') !== input || n <= Date.now()) throw new Error('The suspension end must be a valid future date and time in UTC.');
  return n;
}
async function authorize(interaction, userId, kind = 'infraction') {
  const actor = await require('./access').requireAccess(interaction, kind);
  const target = await interaction.guild.members.fetch({ user: userId, force: true });
  const me = await interaction.guild.members.fetchMe();
  if (target.user.bot) throw new Error('Choose a human member rather than a bot account.');
  if (target.id === interaction.guild.ownerId && actor.id !== interaction.guild.ownerId) throw new Error('Only the server owner may issue an action on the owner’s record.');
  if (!me.permissions.has(D.PermissionFlagsBits.ManageRoles)) throw new Error('Move the bot role above the target and grant Manage Roles.');
  return { actor, target, me };
}
function checkRole(role, actor, me, guild) {
  if (!role || role.id === guild.id || role.managed || me.roles.highest.comparePositionTo(role) <= 0) throw new Error('A required role is missing, managed by Discord, or above the bot.');
}
async function applyCase(guild, item) {
  const member = await guild.members.fetch({ user: item.userId, force: true });
  // Remove/add individual roles to preserve unrelated changes made by other staff.
  for (const role of item.add) if (!member.roles.cache.has(role)) await member.roles.add(role, `Case ${item._id}`);
  for (const role of item.remove) if (!item.add.includes(role) && member.roles.cache.has(role)) await member.roles.remove(role, `Case ${item._id}`);
  await collection('members').replaceOne({ _id: item.next._id }, item.next, { upsert: true });
  await collection('cases').updateOne({ _id: item._id }, { $set: { status: 'applied' } });
}
async function logCase(guild, item) {
  const channel = await guild.channels.fetch(item.logChannel);
  let message;
  if (item.messageId) message = await channel.messages.fetch(item.messageId).catch(e => { if(e.code!==10008) throw e; return null; });
  if (!message) {
    message = await channel.send(caseNotice(item));
    await collection('cases').updateOne({ _id: item._id }, { $set: { messageId: message.id } });
    item.messageId = message.id;
  }
  if (item.kind === 'infraction' && !item.threadId && message.startThread) {
    try {
      const thread = message.thread || await message.startThread({name:`INF-${item._id} | ${item.username || item.userId} | ${item.type}`.slice(0,100), autoArchiveDuration:1440});
      await collection('cases').updateOne({_id:item._id},{$set:{threadId:thread.id}});
    } catch { console.error('Infraction posted; case thread unavailable:',item._id); }
  }
  if (item.notifyMember !== false && !item.dmAttempted) {
    let delivered = false;
    try { const user = await guild.client.users.fetch(item.userId); await user.send(caseNotice(item, message.url)); delivered = true; } catch {}
    await collection('cases').updateOne({_id:item._id},{$set:{dmAttempted:true,dmDelivered:delivered}});
  }
  await collection('cases').updateOne({ _id: item._id }, { $set: { status: 'logged', noticeVersion: 2 } });
}
async function issue(interaction, data, reason, dateText) {
  return locked(`member:${interaction.guildId}:${data.userId}`, async () => {
    const { actor, target, me } = await authorize(interaction, data.userId, data.kind);
    await interaction.guild.roles.fetch();
    const prior = await collection('cases').findOne({ _id: interaction.id });
    if (prior) throw new Error('This submission was already recorded.');
    if (await collection('cases').findOne({ guildId: interaction.guildId, userId: data.userId, status: 'prepared' })) throw new Error('An earlier role change is being retried. Wait for it to finish.');
    const key = `${interaction.guildId}:${data.userId}`;
    const state = await collection('members').findOne({ _id: key }) || { _id: key, guildId: interaction.guildId, userId: data.userId, warnings: 0, strikes: 0, total: 0 };
    if (state.suspension) throw new Error('This member is suspended. Wait for restoration before issuing another role change.');
    const add = [], remove = [];
    let next = { ...state }, summary;
    const log = await destination(interaction.guild, data.kind === 'promotion' ? 'promotions' : 'infractions');
    if (data.kind === 'promotion') {
      const oldRole = interaction.guild.roles.cache.get(data.previous), newRole = interaction.guild.roles.cache.get(data.next);
      checkRole(oldRole, actor, me, interaction.guild); checkRole(newRole, actor, me, interaction.guild);
      if (oldRole.id === newRole.id || !target.roles.cache.has(oldRole.id)) throw new Error('Select two different ranks; the member must currently hold the previous rank.');
      if (target.roles.cache.has(newRole.id)) throw new Error('The member already has the new rank.');
      if ([...ROLES.warnings, ...ROLES.strikes, ROLES.suspended, ROLES.retained].includes(oldRole.id) || [...ROLES.warnings, ...ROLES.strikes, ROLES.suspended, ROLES.retained].includes(newRole.id)) throw new Error('Select rank roles rather than disciplinary or protected roles.');
      add.push(newRole.id); remove.push(oldRole.id);
      summary = `**Member:** <@${target.id}>\n**Previous rank:** <@&${oldRole.id}>\n**New rank:** <@&${newRole.id}>`;
    } else {
      if (!TYPES.includes(data.type)) throw new Error('Invalid infraction type.');
      const counts = advance(state, data.type);
      next = { ...next, warnings: counts.warnings, strikes: counts.strikes, total: (state.total || 0) + 1 };
      if (counts.suspend) {
        const ends = dateText?.trim() ? endDate(dateText.trim()) : undefined;
        const roles = target.roles.cache.filter(r => r.id !== interaction.guildId && !r.managed);
        for (const role of roles.values()) checkRole(role, actor, me, interaction.guild);
        for (const id of [ROLES.retained, ROLES.suspended]) checkRole(interaction.guild.roles.cache.get(id), actor, me, interaction.guild);
        // Save the full removable-role snapshot before any role is removed.
        next.suspension = { ...(ends ? { ends } : {}), roles: roles.map(r => r.id), caseId: interaction.id };
        remove.push(...roles.filter(r => r.id !== ROLES.retained).map(r => r.id));
        add.push(ROLES.retained, ROLES.suspended);
      } else if (data.type === 'Warning' || data.type === 'Strike') {
        const markers = [...ROLES.warnings, ...ROLES.strikes];
        const desired = [ROLES.warnings[counts.warnings - 1], ROLES.strikes[Math.min(counts.strikes, 2) - 1]].filter(Boolean);
        for (const id of new Set([...desired, ...markers.filter(id => target.roles.cache.has(id))])) checkRole(interaction.guild.roles.cache.get(id), actor, me, interaction.guild);
        remove.push(...markers.filter(id => target.roles.cache.has(id) && !desired.includes(id)));
        add.push(...desired);
      }
      summary = `**Member:** <@${target.id}>\n**Type:** ${data.type}\n**Infraction count:** ${next.total}\n**Warnings:** ${next.warnings}/3\n**Strikes:** ${next.strikes}`;
      if (data.type === 'Warning' && counts.warnings === 0) summary += '\n**Escalation:** Third warning converted to a strike.';
      if (next.suspension?.ends) summary += `\n**Suspended until:** <t:${Math.floor(next.suspension.ends / 1000)}:F>`;
    }
    summary += `\n**Reason:** ${D.escapeMarkdown(reason)}\n**Issued by:** <@${interaction.user.id}>`;
    const item = { username: target.user.username || data.userId, notes: data.notes || '', evidence: data.evidence || '', appealable: Boolean(data.appealable), approvedBy: data.approvedBy || actor.id, effectiveDate: data.effectiveDate || new Date().toISOString().slice(0,10), previous: data.previous || null, newRole: data.next || null, newRoleName: data.kind === 'promotion' ? interaction.guild.roles.cache.get(data.next)?.name : null, notifyMember: data.notifyMember !== false, _id: interaction.id, guildId: interaction.guildId, userId: data.userId, kind: data.kind, type: data.type || null, reason, actorId: actor.id, created: Date.now(), next, add, remove, summary, logChannel: log.id, status: 'prepared' };
    await collection('cases').insertOne(item);
    try { await applyCase(interaction.guild, item); }
    catch { throw new Error(`Case ${item._id} is saved. A role update failed and will retry automatically; do not issue it again.`); }
    try { await logCase(interaction.guild, item); }
    catch { return 'The action was applied and saved. Posting its notice failed and will retry automatically.'; }
    return `Saved and posted in <#${log.id}>.`;
  });
}
let busy = false;
async function recover(client) {
  if (busy) return;
  busy = true;
  try {
    const pending = await collection('cases').find({ status: { $in: ['prepared','applied'] } }).toArray();
    for (const item of pending) {
      try { await locked(`member:${item.guildId}:${item.userId}`, async () => {
        const fresh = await collection('cases').findOne({ _id: item._id });
        const guild = await client.guilds.fetch(item.guildId);
        if (fresh.status === 'prepared') await applyCase(guild, fresh);
        if (['prepared','applied'].includes(fresh.status)) await logCase(guild, fresh);
      }); } catch (e) { console.error('Case retry pending:', item._id, e.code || e.name); }
    }
    for (const state of await collection('members').find({ 'suspension.ends': { $lte: Date.now() } }).toArray()) {
      try { await locked(`member:${state.guildId}:${state.userId}`, async () => {
        const fresh = await collection('members').findOne({ _id: state._id });
        if (!fresh.suspension || !Number.isFinite(fresh.suspension.ends) || fresh.suspension.ends > Date.now()) return;
        const guild = await client.guilds.fetch(state.guildId);
        const member = await guild.members.fetch({ user: state.userId, force: true });
        const me = await guild.members.fetchMe(); await guild.roles.fetch();
        const roles = fresh.suspension.roles.filter(id => id !== ROLES.suspended);
        // Missing/deleted or unmanageable roles keep the restoration pending.
        for (const id of roles) checkRole(guild.roles.cache.get(id), null, me, guild);
        for (const id of roles) await member.roles.add(id, 'Suspension ended: restore saved roles');
        await member.roles.remove(ROLES.suspended, 'Suspension ended');
        // Restoration does not erase the member's infraction history or totals.
        await collection('members').updateOne({ _id: state._id }, { $unset: { suspension: '' } });
        await destination(guild, 'infractions').then(c => c.send(v2('Suspension Ended', `Restored saved roles for <@${state.userId}>. Infraction history and totals are retained.`))).catch(() => {});
      }); } catch (e) { console.error('Restoration pending:', state._id, e.code || e.name); }
    }
  } finally { busy = false; }
}
module.exports = { settings, destination, advance, endDate, authorize, issue, recover };

async function endSuspension(i,userId) {
  return locked(`member:${i.guildId}:${userId}`,async()=>{
    await authorize(i,userId);
    const state=await collection('members').findOne({_id:`${i.guildId}:${userId}`});
    if(!state?.suspension)throw new Error('This member is not suspended.');
    await collection('members').updateOne({_id:state._id},{$set:{suspension:{...state.suspension,ends:Date.now(),endedBy:i.user.id}}});
    return 'Suspension end saved. Role restoration will run within 30 seconds; missing roles or permissions will keep it pending for retry.';
  });
}
module.exports.endSuspension=endSuspension;
