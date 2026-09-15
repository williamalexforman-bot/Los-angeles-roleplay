const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

const db = new Database(path.join(__dirname, '../../database.db'));
db.pragma('journal_mode = WAL');

// Settings cache
const settingsCache = new Map();

function initDatabase() {
    // Info tables
    db.prepare(`CREATE TABLE IF NOT EXISTS infractions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        promoted_by TEXT NOT NULL,
        old_rank TEXT NOT NULL,
        new_rank TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ticket_type TEXT DEFAULT 'general',
        status TEXT DEFAULT 'open',
        claimed_by TEXT,
        close_reason TEXT,
        created_at INTEGER NOT NULL
    )`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        winner_count INTEGER DEFAULT 1,
        end_time INTEGER NOT NULL,
        ended INTEGER DEFAULT 0,
        entries TEXT DEFAULT '[]'
    )`).run();

    // Configuration / Settings Table
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`).run();

    // Initialize cache
    const allSettings = db.prepare('SELECT * FROM settings').all();
    for (const row of allSettings) {
        settingsCache.set(row.key, row.value);
    }

    logger.success('Local SQLite Database initialized and settings cached');
}

function getSetting(key, fallback = null) {
    if (settingsCache.has(key)) return settingsCache.get(key);
    return fallback;
}

function setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    settingsCache.set(key, value);
}

// Helper to get formatted ID counters (mimicking getNextId)
function getNextId(table) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    return row.count + 1;
}

const dbHelpers = {
    // Infractions
    infractions: {
        add: (data) => db.prepare('INSERT INTO infractions (guild_id, user_id, moderator_id, type, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(data.guild_id, data.user_id, data.moderator_id, data.type, data.reason, data.timestamp),
        list: (userId, guildId) => db.prepare('SELECT * FROM infractions WHERE user_id = ? AND guild_id = ?').all(userId, guildId),
        remove: (id) => db.prepare('DELETE FROM infractions WHERE id = ?').run(id)
    },
    // Promotions
    promotions: {
        add: (data) => db.prepare('INSERT INTO promotions (guild_id, user_id, promoted_by, old_rank, new_rank, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run(data.guild_id, data.user_id, data.promoted_by, data.old_rank, data.new_rank, data.reason, data.timestamp),
        history: (userId, guildId) => db.prepare('SELECT * FROM promotions WHERE user_id = ? AND guild_id = ?').all(userId, guildId)
    },
    // Tickets
    tickets: {
        create: (data) => db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, ticket_type, created_at) VALUES (?, ?, ?, ?, ?)').run(data.guild_id, data.channel_id, data.user_id, data.ticket_type, data.created_at),
        close: (channelId, reason) => db.prepare('UPDATE tickets SET status = "closed", close_reason = ? WHERE channel_id = ?').run(reason, channelId),
        get: (channelId) => db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId)
    },
    // Giveaways
    giveaways: {
        create: (data) => db.prepare('INSERT INTO giveaways (guild_id, channel_id, message_id, host_id, prize, winner_count, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)').run(data.guild_id, data.channel_id, data.message_id, data.host_id, data.prize, data.winner_count, data.end_time),
        updateEntries: (messageId, entries) => db.prepare('UPDATE giveaways SET entries = ? WHERE message_id = ?').run(JSON.stringify(entries), messageId),
        end: (messageId) => db.prepare('UPDATE giveaways SET ended = 1 WHERE message_id = ?').run(messageId),
        getActive: () => db.prepare('SELECT * FROM giveaways WHERE ended = 0').all()
    }
};

module.exports = { initDatabase, getSetting, setSetting, getNextId, ...dbHelpers };
