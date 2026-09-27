const crypto = require('node:crypto');
const { REST, Routes } = require('discord.js');

function commandHash(commands) {
  return crypto.createHash('sha256').update(JSON.stringify(commands)).digest('hex');
}

async function syncCommands(client, definitions) {
  const { token, clientId, guildId, scope } = client.appConfig;
  const serialized = definitions.map(command => command.toJSON());
  const hash = commandHash(serialized);
  const scopeKey = scope === 'global' ? 'global' : `guild:${guildId}`;
  const state = client.db.prepare('SELECT * FROM command_state WHERE scope = ?').get(scopeKey);
  const now = Date.now();
  if (state?.blocked_until > now) return { status: 'cooldown', retryAt: state.blocked_until };
  if (state?.command_hash === hash) return { status: 'unchanged', count: serialized.length };

  const rest = new REST({ version: '10' }).setToken(token);
  const route = scope === 'global' ? Routes.applicationCommands(clientId) : Routes.applicationGuildCommands(clientId, guildId);
  try {
    const saved = await rest.put(route, { body: serialized });
    client.db.prepare(`INSERT INTO command_state(scope,command_hash,blocked_until,updated_at) VALUES(?,?,NULL,?)
      ON CONFLICT(scope) DO UPDATE SET command_hash=excluded.command_hash,blocked_until=NULL,updated_at=excluded.updated_at`)
      .run(scopeKey, hash, now);
    return { status: 'completed', count: saved.length };
  } catch (error) {
    if (error.status === 429 || error.code === 429) {
      const retrySeconds = Number(error.retryAfter || error.rawError?.retry_after || 60);
      const blockedUntil = now + Math.ceil(retrySeconds * 1000);
      client.db.prepare(`INSERT INTO command_state(scope,command_hash,blocked_until,updated_at) VALUES(?,NULL,?,?)
        ON CONFLICT(scope) DO UPDATE SET blocked_until=excluded.blocked_until,updated_at=excluded.updated_at`)
        .run(scopeKey, blockedUntil, now);
      return { status: 'cooldown', retryAt: blockedUntil };
    }
    throw error;
  }
}

module.exports = { commandHash, syncCommands };
