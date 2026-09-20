require('dotenv').config();
process.env.GUILD_ID = require('./src/settings').GUILD_ID;
const http = require('node:http');
const D = require('discord.js');
const store = require('./src/store');
const { commands } = require('./src/commands/config');
const { handleInteraction } = require('./src/interactions');
const { recover } = require('./src/discipline');
const { syncTicketAccess } = require('./src/tickets');
const { runTask, startTask } = require('./src/runtime');
const { botToken } = require('./src/connection-health');
const token = botToken();
let client, databaseReady = false;
const { writeSync } = require('node:fs');
function lifecycle(event, details = {}) {
  const memory = process.memoryUsage();
  const record = { event, at: new Date().toISOString(), pid: process.pid, uptimeSeconds: Math.floor(process.uptime()), discord: client?.isReady() || false, database: databaseReady, rssMB: Math.round(memory.rss / 1048576), commit: process.env.RENDER_GIT_COMMIT || 'local', ...details };
  try { writeSync(2, JSON.stringify(record) + '\n'); } catch {}
}
process.on('exit', code => lifecycle('process_exit', { code }));
process.on('uncaughtExceptionMonitor', (error, origin) => lifecycle('fatal_error', { origin, errorType: error?.name, errorCode: error?.code }));
setInterval(() => lifecycle('heartbeat'), 60000).unref();
console.log('Bot starting:', process.env.RENDER_GIT_COMMIT || 'local', 'Node', process.version);
process.on('SIGTERM', () => { lifecycle('host_sigterm'); process.exit(0); });
http.createServer((req,res) => {
  const discordReady = client?.isReady() || false;
  const readinessCheck = req.url.split('?')[0] !== '/livez';
  res.writeHead(readinessCheck && (!discordReady || !databaseReady) ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ service: 'running', discord: discordReady, database: databaseReady, commit: process.env.RENDER_GIT_COMMIT || 'local', uptimeSeconds: Math.floor(process.uptime()) }));
}).listen(Number(process.env.PORT || 10000),'0.0.0.0');
if (!token) { lifecycle('configuration_error',{errorCode:'BOT_TOKEN_MISSING'});process.exit(1); }
else {
  let presenceTimer,startupStarted=false,commandsRegistered=false;
  const recovery=require('./src/discord-recovery').discordRecovery({token,log:lifecycle,fatal:()=>process.exit(1),createClient:()=>{
  clearInterval(presenceTimer);
  client = new D.Client({ rest: { rejectOnRateLimit: data => /\/guilds\/[^/]+\/emojis(?:\/|$)/.test(data.route) }, intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildEmojisAndStickers, D.GatewayIntentBits.GuildMembers, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent, D.GatewayIntentBits.DirectMessages, D.GatewayIntentBits.GuildModeration], partials:[D.Partials.Channel,D.Partials.Message,D.Partials.GuildMember] });
  require('./src/panel-emojis').configure(client);
  require('./src/logging').registerLogs(client);
  presenceTimer=require('./src/presence').registerPresence(client);
  client.on('error', e => console.error('Discord client error:', e.code || e.name));
  client.on('shardError', e => console.error('Discord connection error:', e.code || e.name));
  client.on('shardDisconnect', (event, id) => {
    lifecycle('discord_disconnected',{shard:id,closeCode:event.code});
    if (event.code === 4004) console.error('Discord rejected authentication. Replace BOT_TOKEN in Render with the bot token from the Discord Developer Portal.');
    if (event.code === 4014) console.error('Enable Server Members Intent and Message Content Intent for this bot in the Discord Developer Portal.');
  });
  client.on('shardReconnecting', id => lifecycle('discord_reconnecting',{shard:id}));
  client.on('invalidated', () => recovery.invalidated());
  client.on('shardResume', id => lifecycle('discord_resumed',{shard:id}));
  client.once('clientReady', () => runTask('Startup', async () => {
    commandsRegistered=false;
    console.log('Discord connected as', client.user.tag);
    // Emoji REST rate limits must not hold up database/jobs/command registration.
    void runTask('Emoji refresh', async () => { const emojis=await client.guilds.cache.get(process.env.GUILD_ID)?.emojis.fetch(); console.log('Server emojis available:',emojis?.size || 0); });
    void runTask('Role refresh',()=>client.guilds.cache.get(process.env.GUILD_ID)?.roles.fetch());
    if(startupStarted)return;
    startupStarted=true;
    let jobsStarted = false;
    void startTask('Database connection', async () => {
      try { await store.connect(); databaseReady = true; }
      catch(e){databaseReady=false;throw e;}
      if (jobsStarted) return;
      jobsStarted = true;
      void startTask('Event log delivery', () => require('./src/logging').flushLogs(client), 5000);
      void startTask('Ticket opening panels', () => require('./src/tickets').recoverTicketPanels(client), 15000);
      void startTask('Weekly quota',()=>require('./src/quota').tickQuota(client),30000);
      void startTask('Role requests',()=>require('./src/role-requests').recover(client),30000);
      void startTask('Ticket access', () => syncTicketAccess(client), 300000);
      void startTask('Recovery', () => recover(client), 30000);
      void startTask('V2 case notices', () => require('./src/case-panels').syncCasePanels(client), 300000);
    }, 30000);

    void startTask('Command registration',async()=>{
      if(commandsRegistered||!client.isReady())return;
      const guilds = await require('./src/guild-config').commandGuilds(client);
      await client.application.commands.set([]);
      for (const guild of guilds) {
        await guild.commands.set(commands.map(c => c.toJSON()));
        if(databaseReady) await require('./src/logging').record('bot',guild.id,'Bot Online','Discord connected and commands registered.',`startup:${process.env.RENDER_GIT_COMMIT || Date.now()}`);
      }
      console.log('Registered commands: ' + commands.map(c => '/' + c.name).join(', '));
      commandsRegistered=true;
    },30000);

  }));
  client.on('guildMemberAdd', member => member.guild.id === process.env.GUILD_ID && runTask('Welcome message', () => require('./src/welcome').welcome(member)));
  client.on('interactionCreate',handleInteraction);
  client.on('messageCreate',message => runTask('Message handler', async () => {
    if(message.guild?.id === process.env.GUILD_ID) return require('./src/messages').handleMessage(message);
  }));
  return client;
  }});
  setInterval(()=>{void recovery.tick();},10000).unref();
  void recovery.start();
}
