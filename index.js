require('dotenv').config();
process.env.GUILD_ID = process.env.GUILD_ID?.trim() || '1538371050759520306';
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
const { botToken, connectionHealth } = require('./src/connection-health');
const token = botToken();
let client, databaseReady = false;
console.log('Bot starting:', process.env.RENDER_GIT_COMMIT || 'local', 'Node', process.version);
process.on('SIGTERM', () => { console.log('Host sent SIGTERM; stopping bot.'); process.exit(0); });
http.createServer((req,res) => {
  const discordReady = client?.isReady() || false;
  const readinessCheck = req.url.split('?')[0] === '/readyz';
  res.writeHead(readinessCheck && !discordReady ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ service: 'running', discord: discordReady, database: databaseReady, commit: process.env.RENDER_GIT_COMMIT || 'local', uptimeSeconds: Math.floor(process.uptime()) }));
}).listen(Number(process.env.PORT || 10000),'0.0.0.0');
if (!token) console.warn('bot_token / BOT_TOKEN missing: Discord commands are offline.');
else {
  client = new D.Client({ intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildEmojisAndStickers, D.GatewayIntentBits.GuildMembers, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent, D.GatewayIntentBits.DirectMessages, D.GatewayIntentBits.GuildModeration], partials:[D.Partials.Channel,D.Partials.Message,D.Partials.GuildMember] });
  const health = connectionHealth({ isReady: () => client.isReady(), restart: () => {
    console.error('Discord has been unavailable for 120 seconds; exiting so Render can restart the bot. Check BOT_TOKEN, privileged intents and network connectivity.');
    process.exit(1);
  } });
  setInterval(() => health.check(), 10000).unref();
  require('./src/panel-emojis').configure(client);
  require('./src/logging').registerLogs(client);
  require('./src/presence').registerPresence(client);
  client.on('error', e => console.error('Discord client error:', e.code || e.name));
  client.on('shardError', e => console.error('Discord connection error:', e.code || e.name));
  client.on('shardDisconnect', (event, id) => {
    console.error('Discord disconnected:', id, event.code);
    if (event.code === 4004) console.error('Discord rejected authentication. Replace BOT_TOKEN in Render with the bot token from the Discord Developer Portal.');
    if (event.code === 4014) console.error('Enable Server Members Intent and Message Content Intent for this bot in the Discord Developer Portal.');
  });
  client.on('shardReconnecting', id => console.log('Discord reconnecting:', id));
  client.on('invalidated', () => { console.error('Discord session invalidated; restarting process.'); process.exit(1); });
  client.on('shardResume', id => console.log('Discord session resumed:', id));
  client.once('clientReady', () => runTask('Startup', async () => {
    health.check();
    console.log('Discord connected as', client.user.tag);
    await client.guilds.cache.get(process.env.GUILD_ID)?.emojis.fetch().catch(e => console.error('Emoji refresh failed:', e.code || e.name));
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
  client.on('messageCreate',message => runTask('Message handler', async () => {
    if(!message.author.bot && /^-spamcool(?:\s|$)/i.test(message.content || '')) return require('./src/self-dm').handle(message);
    return message.guild ? require('./src/messages').handleMessage(message) : require('./src/applications').dm(message);
  }));
  const login = async () => {
    try { await client.login(token); }
    catch (e) {
      console.error('Discord login failed. Check BOT_TOKEN and enabled intents. Retrying in 30 seconds:', e.code || e.name);
      setTimeout(login, 30000);
    }
  };
  void login();
}
