const { getSetting } = require('./database');
const logger = require('./logger');

const cooldowns = new Map();

function ownerId() {
    return getSetting('SERVER_OWNER_ID', process.env.SERVER_OWNER_ID || process.env.OWNER_ID);
}

function hasPermission(member, settingKey) {
    // Server owner bypass (set via /config or environment)
    const publicOwnerId = ownerId();
    if (publicOwnerId && member.id === publicOwnerId) return true;

    // Role-based check
    const allowedRolesStr = getSetting(settingKey, '');
    if (!allowedRolesStr) return false;

    const allowedRoles = allowedRolesStr.split(',').map(s => s.trim());
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

function checkRateLimit(userId, commandName, limitMs = 3000) {
    // Server owner bypasses rate limits
    const publicOwnerId = ownerId();
    if (publicOwnerId && userId === publicOwnerId) {
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

module.exports = { hasPermission, checkRateLimit, ownerId };
