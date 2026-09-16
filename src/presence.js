const { ActivityType } = require('discord.js');
function updatePresence(client, env = process.env) {
  if (!client.isReady()) return;
  const id = env.GUILD_ID?.trim();
  const guild = id ? client.guilds.cache.get(id) : client.guilds.cache.size === 1 ? client.guilds.cache.first() : null;
  if (!guild || !Number.isFinite(guild.memberCount)) return;
  client.user.setPresence({ status: 'online', activities: [{ name: `over ${guild.memberCount.toLocaleString('en-US')} server members`, type: ActivityType.Watching }] });
}
function registerPresence(client) {
  const update = () => { try { updatePresence(client); } catch (e) { console.error('Presence update failed:', e.code || e.name); } };
  for (const event of ['clientReady', 'guildMemberAdd', 'guildMemberRemove', 'guildCreate', 'guildDelete', 'shardResume']) client.on(event, update);
  const timer = setInterval(update, 60000);
  timer.unref();
  return timer;
}
module.exports = { updatePresence, registerPresence };
