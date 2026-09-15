require('dotenv').config();
const http = require('node:http');
const D = require('discord.js');
const store = require('./src/store');
const { commands } = require('./src/commands/config');
const { handleInteraction } = require('./src/interactions');
const { recover, destination } = require('./src/discipline');
const { syncTicketAccess } = require('./src/tickets');
const { syncShifts } = require('./src/shifts');
const { tickQuota } = require('./src/quota');
const { v2 } = require('./src/panels');
const token = process.env.bot_token?.trim() || process.env.BOT_TOKEN?.trim();
let discordReady = false, databaseReady = false;
http.createServer((req,res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'running', discord: discordReady, database: databaseReady }));
}).listen(Number(process.env.PORT || 10000),'0.0.0.0');
if (!token) console.warn('bot_token / BOT_TOKEN missing: Discord commands are offline.');
else {
  const client = new D.Client({ intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildMembers, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent] });
  client.once('clientReady', async () => {
    discordReady = true;
    try { await store.connect(); databaseReady = true; }
    catch { console.error('Database unavailable: configure MongoDB for persistent records and suspension recovery.'); }
    try {
      await client.application.commands.set([]);
      for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands.map(c => c.toJSON()));
        if (databaseReady) await destination(guild,'deployment').then(c => c.send(v2('Bot Deployment', 'The bot is online. Panel configuration, tickets, infractions, promotions and staff shifts are ready.'))).catch(() => console.error('Could not post deployment notice.'));
      }
      console.log('Registered commands: ' + commands.map(c => '/' + c.name).join(', '));
    } catch { console.error('Command registration failed. Check Discord permissions.'); }
    if (databaseReady) {
      await tickQuota(client);
      setInterval(() => tickQuota(client),30000);
      await syncTicketAccess(client);
      setInterval(() => syncTicketAccess(client), 300000);
      await syncShifts(client);
      setInterval(() => syncShifts(client), 30000);
      await recover(client).catch(() => console.error('Recovery is pending.'));
      setInterval(() => recover(client).catch(() => console.error('Recovery is pending.')),30000);
    }
  });
  client.on('interactionCreate',handleInteraction);
  client.on('messageCreate',require('./src/messages').handleMessage);
  client.login(token).catch(e => console.error('Discord login failed. Check bot_token / BOT_TOKEN and enable Server Members and Message Content intents.', e.code || e.name));
}
