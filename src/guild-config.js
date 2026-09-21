async function commandGuilds(client, env = process.env) {
  const id = env.GUILD_ID?.trim();
  if (!id) return [...client.guilds.cache.values()];
  if (!/^\d{17,20}$/.test(id)) throw new Error('GUILD_ID must be the numeric Discord server ID.');
  const cached=client.guilds.cache?.get?.(id);
  if(cached)return [cached];
  try { return [await client.guilds.fetch(id)]; }
  catch {
    const visible=[...(client.guilds.cache?.values?.() || [])].map(g=>`${g.name} (${g.id})`).join(', ') || 'none';
    throw new Error(`The bot cannot access GUILD_ID ${id}. Check that this exact server ID is configured and the bot is installed there. Servers currently visible to the bot: ${visible}`);
  }
}
module.exports = { commandGuilds };
