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
const { runTask, startTask } = require('./src/runtime');
const token = process.env.BOT_TOKEN?.trim() || process.env.bot_token?.trim();
let discordReady = false, databaseReady = false;
console.log('Bot starting:', process.env.RENDER_GIT_COMMIT || 'local', 'Node', process.version);
process.on('SIGTERM', () => { console.log('Host sent SIGTERM; stopping bot.'); process.exit(0); });
http.createServer((req,res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'running', discord: discordReady, database: databaseReady }));
}).listen(Number(process.env.PORT || 10000),'0.0.0.0');
if (!token) console.warn('bot_token / BOT_TOKEN missing: Discord commands are offline.');
else {
  const client = new D.Client({ intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildMembers, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent, D.GatewayIntentBits.DirectMessages, D.GatewayIntentBits.GuildModeration], partials:[D.Partials.Channel,D.Partials.Message,D.Partials.GuildMember] });
  require('./src/logging').registerLogs(client);
  client.on('error', e => console.error('Discord client error:', e.code || e.name));
  client.on('shardError', e => console.error('Discord connection error:', e.code || e.name));
  client.on('shardDisconnect', (event, id) => { discordReady = false; console.error('Discord disconnected:', id, event.code); });
  client.on('shardReconnecting', id => console.log('Discord reconnecting:', id));
  client.on('shardReady', () => { discordReady = true; });
  client.on('invalidated', () => { discordReady = false; console.error('Discord session invalidated; restarting process.'); process.exit(1); });
  client.on('shardResume', () => { discordReady = true; });
  client.once('clientReady', () => runTask('Startup', async () => {
    discordReady = true;
    let jobsStarted = false;
    void startTask('Database connection', async () => {
      if (!databaseReady) { await store.connect(); databaseReady = true; }
      if (jobsStarted) return;
      jobsStarted = true;
      void startTask('Event log delivery', () => require('./src/logging').flushLogs(client), 5000);
      void startTask('Ticket opening panels', () => require('./src/tickets').recoverTicketPanels(client), 15000);
      await startTask('Quota', () => tickQuota(client), 30000);
      await startTask('Ticket access', () => syncTicketAccess(client), 300000);
      await startTask('Shifts', () => syncShifts(client), 30000);
      await startTask('Recovery', () => recover(client), 30000);
      await startTask('V2 case notices', () => require('./src/case-panels').syncCasePanels(client), 300000);
      await startTask('Applications', () => require('./src/applications').recoverApplications(client), 30000);
    }, 30000);
    try {
      const guilds = await require('./src/guild-config').commandGuilds(client);
      await client.application.commands.set([]);
      for (const guild of guilds) {
        await guild.commands.set(commands.map(c => c.toJSON()));
        if (databaseReady) await destination(guild,'deployment').then(c => c.send(v2('Bot Deployment', 'The bot is online. Panel configuration, tickets, infractions, promotions and staff shifts are ready.'))).catch(() => console.error('Could not post deployment notice.'));
      }
      console.log('Registered commands: ' + commands.map(c => '/' + c.name).join(', '));
    } catch (e) { console.error('Command registration failed:', e.name === 'Error' ? e.message : e.code || e.name); }

  }));
  client.on('guildMemberAdd', member => runTask('Welcome message', () => require('./src/welcome').welcome(member)));
  client.on('interactionCreate',handleInteraction);
  client.on('messageCreate',message => message.guild ? require('./src/messages').handleMessage(message) : require('./src/applications').dm(message));
  client.login(token).catch(e => console.error('Discord login failed. Check bot_token / BOT_TOKEN and enable Server Members and Message Content intents.', e.code || e.name));
}
