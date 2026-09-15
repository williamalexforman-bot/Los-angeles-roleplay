const { ActivityType } = require('discord.js');
const { startErlcLogPoller } = require('../utils/erlcLogs');
const { getPlayers } = require('../utils/erlcApi');
const { giveaways } = require('../utils/database');
const logger = require('../utils/logger');

async function updateActivity(client) {
    const botName = process.env.BOT_NAME || 'Utility Bot';
    try {
        const players = await getPlayers();
        const count = Array.isArray(players) ? players.length : 0;
        client.user.setActivity(`${count} players in ${botName}`, { type: ActivityType.Watching });
    } catch {
        client.user.setActivity(botName, { type: ActivityType.Watching });
    }
}

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        logger.success(`${client.user.tag} is online and professional!`);
        
        // Load active giveaways from DB
        const activeGives = giveaways.getActive();
        activeGives.forEach(g => {
            client.giveaways.set(g.message_id, {
                prize: g.prize,
                winners: g.winner_count,
                endTime: g.end_time,
                entries: new Set(JSON.parse(g.entries)),
                channelId: g.channel_id,
                hostId: g.host_id
            });
        });
        logger.info(`Synced ${activeGives.length} active giveaways from local database`);

        updateActivity(client);
        setInterval(() => updateActivity(client), 60000);
        startErlcLogPoller(client);
    }
};
