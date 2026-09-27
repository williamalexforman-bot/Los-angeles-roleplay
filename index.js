require('dotenv').config();
const http=require('node:http');
const {Client,GatewayIntentBits,Partials}=require('discord.js');
const {config}=require('./src/config');
const {openDatabase}=require('./src/database');
const {start}=require('./src/bot');

const appConfig=config();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildModeration],partials:[Partials.Channel,Partials.Message,Partials.GuildMember]});
client.appConfig=appConfig;
client.db=openDatabase(appConfig.sqlitePath);
client.readyState={discord:false,database:true,commands:false};

const server=http.createServer((req,res)=>{const live=req.url==='/livez',ready=req.url==='/readyz'&&client.isReady()&&client.readyState.database;res.writeHead(live||ready?200:503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({service:'graphic-design-discord-bot',live:true,ready:Boolean(ready),discord:client.isReady(),database:client.readyState.database,commands:client.readyState.commands}));});
server.listen(appConfig.port,'0.0.0.0',()=>console.log(`Health server listening on ${appConfig.port}`));
process.on('SIGTERM',()=>{client.destroy();client.db.close();server.close(()=>process.exit(0));});
process.on('unhandledRejection',error=>console.error('Unhandled rejection',error));
process.on('uncaughtExceptionMonitor',error=>console.error('Uncaught exception',error));
start(client).catch(error=>{console.error('Startup failed',error);process.exitCode=1;});
