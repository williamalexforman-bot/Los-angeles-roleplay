const path = require('node:path');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function config() {
  return {
    token: required('BOT_TOKEN'),
    clientId: process.env.CLIENT_ID?.trim() || null,
    guildId: process.env.GUILD_ID?.trim() || null,
    ownerId: process.env.BOT_OWNER_ID?.trim() || null,
    serverName: process.env.SERVER_NAME?.trim() || 'Graphic Design Community',
    sqlitePath: path.resolve(process.env.SQLITE_PATH || './data/bot.sqlite'),
    port: Number(process.env.PORT || 10000),
    scope: process.env.COMMAND_SCOPE === 'global' ? 'global' : 'guild',
  };
}

module.exports = { config, required };
