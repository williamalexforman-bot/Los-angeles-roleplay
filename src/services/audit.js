const { settings } = require('../database');
const { embed, COLORS } = require('../utilities/ui');

async function audit(client, guild, category, actorId, targetId, action, reason, referenceId) {
  const result = client.db.prepare(`INSERT INTO audit_logs(guild_id,category,actor_id,target_id,action,reason,reference_id,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(guild.id, category, actorId || null, targetId || null, action, reason || null, referenceId || null, Date.now());
  const cfg = settings(client.db, guild.id);
  const channelId = cfg[`${category}_log_channel`] || cfg.log_channel;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [embed(`${category.replaceAll('_',' ')} Log`, `**Action:** ${action}\n**Actor:** ${actorId ? `<@${actorId}>` : 'System'}\n**Target:** ${targetId ? `<@${targetId}>` : 'None'}\n**Reason:** ${reason || 'None'}\n**Reference:** ${referenceId || 'None'}`, COLORS.primary)], allowedMentions: { parse: [] } });
    client.db.prepare('UPDATE audit_logs SET delivered = 1 WHERE id = ?').run(result.lastInsertRowid);
  } catch (error) {
    console.error('Audit delivery queued:', category, error.code || error.name);
  }
}

module.exports = { audit };
