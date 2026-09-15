require('dotenv').config();
const http = require('node:http');
const D = require('discord.js');
const store = require('./src/store');
const { commands } = require('./src/commands/config');
const { handleInteraction } = require('./src/interactions');
const { recover, destination } = require('./src/discipline');
const { syncTicketAccess } = require('./src/tickets');
const { syncShifts } = require('./src/shifts');
const { v2 } = require('./src/panels');
let discordReady = false, databaseReady = false;
http.createServer((req,res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'running', discord: discordReady, database: databaseReady }));
}).listen(Number(process.env.PORT || 10000),'0.0.0.0');
if (!process.env.BOT_TOKEN) console.warn('BOT_TOKEN missing: Discord commands are offline.');
else {
  const client = new D.Client({ intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent] });
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
      console.log('Registered /config, /infraction, /promotion and /shift.');
    } catch { console.error('Command registration failed. Check Discord permissions.'); }
    if (databaseReady) {
      await syncTicketAccess(client);
      setInterval(() => syncTicketAccess(client), 300000);
      await syncShifts(client);
      setInterval(() => syncShifts(client), 30000);
      await recover(client).catch(() => console.error('Recovery is pending.'));
      setInterval(() => recover(client).catch(() => console.error('Recovery is pending.')),30000);
    }
  });
  client.on('interactionCreate',handleInteraction);
  client.login(process.env.BOT_TOKEN).catch(e => console.error('Discord login failed. Check BOT_TOKEN and enable Message Content Intent.', e.code || e.name));
}
