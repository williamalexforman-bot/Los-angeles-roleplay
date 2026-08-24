/**
 * PM2 Ecosystem Configuration for Discord Management Bot
 * 
 * Keeps the bot running 24/7 with auto-restart on crash,
 * memory management, and log rotation.
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   (to auto-start on system boot)
 */

module.exports = {
    apps: [
        {
            name: 'discord-management-bot',
            script: 'index.js',
            cwd: __dirname,

            // Auto-restart behavior
            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000, // 5 seconds between restarts
            min_uptime: 10000,   // 10 seconds minimum uptime to consider started

            // Resource management
            max_memory_restart: '500M', // Restart if memory exceeds 500MB
            instances: 1,               // Single instance (Discord.js doesn't cluster well)

            // Logging
            out_file: './logs/pm2-output.log',
            error_file: './logs/pm2-error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            combine_logs: true,
            merge_logs: true,

            // Environment
            env: {
                NODE_ENV: 'production',
            },

            // Graceful shutdown
            kill_timeout: 10000,           // 10 seconds to shutdown gracefully
            listen_timeout: 30000,         // Wait 30 seconds for the bot to connect
            shutdown_with_message: true,

            // Watch for file changes (disabled in production)
            watch: false,
        },
    ],
};
