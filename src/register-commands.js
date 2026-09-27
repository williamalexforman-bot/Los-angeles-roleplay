require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { config } = require('./config');
const { openDatabase } = require('./database');
const { commands } = require('./commands/definitions');
const { syncCommands } = require('./services/command-sync');

(async () => {
  const appConfig = config();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.appConfig = appConfig;
  client.db = openDatabase(appConfig.sqlitePath);
  client.user = { id: appConfig.clientId };
  const result = await syncCommands(client, commands);
  console.log(JSON.stringify(result));
  client.db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
