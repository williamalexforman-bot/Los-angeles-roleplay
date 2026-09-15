const erlc = require('./erlcApi');
const { getSetting } = require('./database');
const { v2Msg, env, tpl } = require('./v2');
const logger = require('./logger');

let lastLogs = {
    join: new Set(),
    kill: new Set(),
    command: new Set()
};

let pollInterval = null;

async function poll(client) {
    try {
        const data = await erlc.getServerFull({
            JoinLogs: true,
            KillLogs: true,
            CommandLogs: true
        });

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        // Process Join Logs
        if (data.JoinLogs) {
            const joinChannel = guild.channels.cache.get(getSetting('ERLC_JOINLOGS_CHANNEL_ID'));
            data.JoinLogs.slice(0, 10).reverse().forEach(log => {
                const key = `${log.Player}:${log.Timestamp}:${log.Join}`;
                if (lastLogs.join.has(key)) return;
                lastLogs.join.add(key);

                if (joinChannel) {
                    const action = log.Join ? env('ERLC_JOIN_LABEL', 'Joined') : env('ERLC_LEAVE_LABEL', 'Left');
                    joinChannel.send(v2Msg({
                        title: `Player ${action}`,
                        description: `\`${log.Player}\` has ${action.toLowerCase()} the server.\n**Time:** <t:${log.Timestamp}:T>`,
                        color: log.Join ? '00FF00' : 'FF0000'
                    }));
                }
            });
        }

        // Process Kill Logs
        if (data.KillLogs) {
            const killChannel = guild.channels.cache.get(getSetting('ERLC_KILLLOGS_CHANNEL_ID'));
            data.KillLogs.slice(0, 10).reverse().forEach(log => {
                const key = `${log.Killer}:${log.Killed}:${log.Timestamp}`;
                if (lastLogs.kill.has(key)) return;
                lastLogs.kill.add(key);

                if (killChannel) {
                    killChannel.send(v2Msg({
                        title: 'Kill Log',
                        description: `\`${log.Killer}\` killed \`${log.Killed}\`\n**Time:** <t:${log.Timestamp}:T>`,
                        color: 'FF0000'
                    }));
                }
            });
        }

        // Process Command Logs
        if (data.CommandLogs) {
            const cmdChannel = guild.channels.cache.get(getSetting('ERLC_CMDLOGS_CHANNEL_ID'));
            data.CommandLogs.slice(0, 10).reverse().forEach(log => {
                const key = `${log.Player}:${log.Command}:${log.Timestamp}`;
                if (lastLogs.command.has(key)) return;
                lastLogs.command.add(key);

                if (cmdChannel) {
                    cmdChannel.send(v2Msg({
                        title: 'Command Executed',
                        description: `**Player:** \`${log.Player}\`\n**Command:** \`${log.Command}\`\n**Time:** <t:${log.Timestamp}:T>`
                    }));
                }
            });
        }

        // Cleanup old cache entries (Keep last 100 to prevent memory leak)
        if (lastLogs.join.size > 100) lastLogs.join = new Set(Array.from(lastLogs.join).slice(-50));
        if (lastLogs.kill.size > 100) lastLogs.kill = new Set(Array.from(lastLogs.kill).slice(-50));
        if (lastLogs.command.size > 100) lastLogs.command = new Set(Array.from(lastLogs.command).slice(-50));

    } catch (error) {
        logger.error(`Logging Poll Error: ${error.message}`);
    }
}

function startLogging(client) {
    if (pollInterval) clearInterval(pollInterval);
    
    // Min 30s to stay safe with rate limits
    const interval = Math.max(parseInt(getSetting('ERLC_POLL_INTERVAL', '60')) * 1000, 30000);
    pollInterval = setInterval(() => poll(client), interval);
    logger.info(`ERLC Logging started (Interval: ${interval / 1000}s)`);
}

module.exports = { startLogging };
