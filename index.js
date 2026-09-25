require('dotenv').config();
process.env.GUILD_ID = require('./src/settings').GUILD_ID;
const http = require('node:http');
const D = require('discord.js');
const store = require('./src/store');
const { commands } = require('./src/commands/config');
const { handleInteraction } = require('./src/interactions');
const { recover } = require('./src/discipline');
const { syncTicketAccess } = require('./src/tickets');
const { runTask, startTask, errorDetails } = require('./src/runtime');
const { botToken } = require('./src/connection-health');
const token = botToken();
let client, databaseReady = false, commandsRegistered = false, commandSyncBlockedUntil = 0;
const { writeSync } = require('node:fs');
function lifecycle(event, details = {}) {
  const memory = process.memoryUsage();
  const record = { event, at: new Date().toISOString(), pid: process.pid, uptimeSeconds: Math.floor(process.uptime()), discord: client?.isReady() || false, database: databaseReady, rssMB: Math.round(memory.rss / 1048576), heapUsedMB: Math.round(memory.heapUsed / 1048576), heapTotalMB: Math.round(memory.heapTotal / 1048576), commit: process.env.RENDER_GIT_COMMIT || 'local', ...details };
  try { writeSync(2, JSON.stringify(record) + '\n'); } catch {}
}
process.on('exit', code => lifecycle('process_exit', { code }));
process.on('uncaughtExceptionMonitor', (error, origin) => lifecycle('fatal_error', { origin, ...errorDetails(error) }));
process.on('uncaughtException', (error, origin) => { lifecycle('fatal_restart', { origin, ...errorDetails(error) }); setTimeout(() => process.exit(1), 250).unref(); });
process.on('unhandledRejection', reason => lifecycle('unhandled_rejection', errorDetails(reason)));
process.on('warning', warning => lifecycle('node_warning', errorDetails(warning)));
setInterval(() => lifecycle('heartbeat'), 30000).unref();
console.log('Bot starting:', process.env.RENDER_GIT_COMMIT || 'local', 'Node', process.version);
process.on('SIGTERM', () => { lifecycle('host_sigterm'); process.exit(0); });
const healthServer=http.createServer((req,res) => {
  const response = require('./src/health').healthResponse(req.url, {
    discord: client?.isReady(), database: databaseReady, commands: commandsRegistered,
    commit: process.env.RENDER_GIT_COMMIT || 'local', uptimeSeconds: Math.floor(process.uptime()),
  });
  res.writeHead(response.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(response.body));
});
healthServer.on('error',error=>{lifecycle('health_server_error',errorDetails(error));process.exit(1);});
healthServer.listen(Number(process.env.PORT || 10000),'0.0.0.0',()=>lifecycle('health_server_listening',{port:Number(process.env.PORT || 10000)}));
if (!token) { lifecycle('configuration_error',{errorCode:'BOT_TOKEN_MISSING'});process.exit(1); }
else {
  let presenceTimer,startupStarted=false;
  // Discord.js handles REST/gateway rate-limit waits internally. A short custom
  // timeout creates a reconnect loop on shared Render IPs, so allow the login
  // attempt to remain alive long enough for Discord's cooldown to clear.
  const recovery=require('./src/discord-recovery').discordRecovery({token,offlineMs:900000,retryMs:300000,loginMs:600000,log:lifecycle,fatal:()=>process.exit(1),createClient:()=>{
  clearInterval(presenceTimer);
  commandsRegistered=false;
  client = new D.Client({ shards:[0], shardCount:1, makeCache: D.Options.cacheWithLimits({ ...D.Options.DefaultMakeCacheSettings, MessageManager: 50 }), sweepers: { ...D.Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 900 } }, rest: { rejectOnRateLimit: data => data.route==='/gateway/bot'||/\/guilds\/[^/]+\/emojis(?:\/|$)/.test(data.route) }, intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildEmojisAndStickers, D.GatewayIntentBits.GuildMembers, D.GatewayIntentBits.GuildMessages, D.GatewayIntentBits.MessageContent, D.GatewayIntentBits.DirectMessages, D.GatewayIntentBits.GuildModeration], partials:[D.Partials.Channel,D.Partials.Message,D.Partials.GuildMember] });
  const restGet=client.rest.get.bind(client.rest);
  client.rest.get=async(route,...args)=>{
    try{return await restGet(route,...args);}
    catch(error){
      const rateLimited=error?.status===429||error?.code===429||String(error?.name||'').startsWith('RateLimitError');
      if(route==='/gateway/bot'&&rateLimited){
        lifecycle('discord_gateway_info_fallback',{reason:'RateLimited',shards:1});
        return {url:'wss://gateway.discord.gg',shards:1,session_start_limit:{total:1000,remaining:999,reset_after:60000,max_concurrency:1}};
      }
      throw error;
    }
  };
  require('./src/panel-emojis').configure(client);
  require('./src/logging').registerLogs(client);
  presenceTimer=require('./src/presence').registerPresence(client);
  client.on('error', e => lifecycle('discord_client_error',errorDetails(e)));
  client.on('shardError', e => lifecycle('discord_connection_error',errorDetails(e)));
  client.on('shardDisconnect', (event, id) => {
    lifecycle('discord_disconnected',{shard:id,closeCode:event.code,closeReason:event.reason || null});
    if (event.code === 4004) console.error('Discord rejected authentication. Replace BOT_TOKEN in Render with the bot token from the Discord Developer Portal.');
    if (event.code === 4014) console.error('Enable Server Members Intent and Message Content Intent for this bot in the Discord Developer Portal.');
  });
  client.on('shardReconnecting', id => lifecycle('discord_reconnecting',{shard:id}));
  client.on('shardReady',(id,unavailableGuilds)=>lifecycle('discord_shard_ready',{shard:id,unavailableGuilds:unavailableGuilds?.size||0}));
  const currentClient=client;
  client.on('invalidated', () => recovery.invalidated(currentClient));
  client.on('shardResume', id => lifecycle('discord_resumed',{shard:id}));
  client.rest.on('rateLimited', info => lifecycle('discord_rate_limited',{route:info.route,timeoutMs:info.timeout,limit:info.limit,global:info.global}));
  client.once('clientReady', () => runTask('Startup', async () => {
    commandsRegistered=false;
    console.log('Discord connected as', client.user.tag);
    lifecycle('discord_connected',{botId:client.user.id,botTag:client.user.tag,guilds:client.guilds.cache.size});
    // READY already supplies guild role/emoji caches. Avoid immediate REST reads
    // so command registration gets the first API request after connecting.
    const startupGuild=client.guilds.cache.get(process.env.GUILD_ID);
    console.log('Server emojis cached:',startupGuild?.emojis.cache.size || 0);
    if(startupGuild)console.log('Infraction roles detected:',JSON.stringify(require('./src/discipline-roles').readInfractionRoles(startupGuild)));
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
      if(Date.now()<commandSyncBlockedUntil)return;
      const registeringClient=client;
      try {
        lifecycle('command_registration_started');
        const guilds = await require('./src/guild-config').commandGuilds(registeringClient);
        const serialized=commands.map(c=>c.toJSON());
        for (const guild of guilds) {
          const registered=await Promise.race([
            require('./src/command-sync').sync(token,client.user.id,guild.id,serialized),
            new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('Discord command registration timed out after 60 seconds; it will retry automatically.'),{code:'COMMAND_SYNC_TIMEOUT'})),60000))
          ]);
          const expectedNames=serialized.map(command=>command.name).sort();
          const registeredNames=registered.map(command=>command.name).sort();
          const missing=expectedNames.filter(name=>!registeredNames.includes(name));
          const unexpected=registeredNames.filter(name=>!expectedNames.includes(name));
          if(missing.length||unexpected.length)throw new Error(`Discord command verification failed for guild ${guild.id}; missing: ${missing.join(', ')||'none'}; unexpected: ${unexpected.join(', ')||'none'}`);
          lifecycle('command_registration_completed',{guildId:guild.id,guildName:guild.name,registeredCount:registered.length,commands:registeredNames});
          if(databaseReady) await require('./src/logging').record('bot',guild.id,'Bot Online','Discord connected and commands registered.',`startup:${process.env.RENDER_GIT_COMMIT || Date.now()}`);
        }
        console.log('Registered commands: ' + commands.map(c => '/' + c.name).join(', '));
        if(client===registeringClient)commandsRegistered=true;
      } catch(error) {
        if(error?.status===429&&Number(error.retryAfter)>0){
          commandSyncBlockedUntil=Date.now()+Math.ceil(Number(error.retryAfter)*1000);
          lifecycle('command_registration_rate_limited',{retryAfterSeconds:Math.ceil(Number(error.retryAfter)),retryAt:new Date(commandSyncBlockedUntil).toISOString()});
        }
        console.error('Command registration failed:',JSON.stringify({name:error?.name,message:error?.message,code:error?.code,status:error?.status,raw:error?.rawError?.message}));
      }
    },120000);

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
