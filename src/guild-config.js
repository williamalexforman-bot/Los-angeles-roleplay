async function commandGuilds(client, env = process.env) {
  const id = env.GUILD_ID?.trim();
  if (!id) return [...client.guilds.cache.values()];
  if (!/^\d{17,20}$/.test(id)) throw new Error('GUILD_ID must be the numeric Discord server ID.');
  try { return [await client.guilds.fetch(id)]; }
  catch { throw new Error('The bot cannot access GUILD_ID. Check the server ID and that the bot belongs to that server.'); }
}
module.exports = { commandGuilds };
