const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, key)
    );
    CREATE TABLE IF NOT EXISTS showcases (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      message_id TEXT,
      channel_id TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      showcase_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(showcase_id, user_id, content),
      FOREIGN KEY(showcase_id) REFERENCES showcases(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS portfolios (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      bio TEXT NOT NULL,
      specialties TEXT NOT NULL,
      software TEXT NOT NULL,
      links TEXT NOT NULL,
      availability TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS design_requests (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      colors TEXT,
      size_platform TEXT,
      deadline TEXT,
      references_text TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      claimed_by TEXT,
      channel_id TEXT,
      message_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(request_id) REFERENCES design_requests(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reason TEXT NOT NULL,
      channel_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      created_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS moderation_cases (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      category TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      reference_id TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interaction_locks (
      interaction_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS command_state (
      scope TEXT PRIMARY KEY,
      command_hash TEXT,
      blocked_until INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function settings(db, guildId) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM guild_config WHERE guild_id = ?').all(guildId).map(row => [row.key, row.value]));
}

function setSetting(db, guildId, key, value) {
  db.prepare(`INSERT INTO guild_config(guild_id,key,value,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(guildId, key, value ?? null, Date.now());
}

function lockInteraction(db, interactionId) {
  try {
    db.prepare('INSERT INTO interaction_locks(interaction_id,created_at) VALUES(?,?)').run(interactionId, Date.now());
    return true;
  } catch (error) {
    if (String(error.code).startsWith('ERR_SQLITE_CONSTRAINT') || error.errcode === 1555 || /UNIQUE constraint failed/.test(error.message)) return false;
    throw error;
  }
}

module.exports = { openDatabase, settings, setSetting, lockInteraction };
