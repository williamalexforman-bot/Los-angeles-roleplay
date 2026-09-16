const test=require('node:test'),assert=require('node:assert/strict');
const {commandGuilds}=require('../src/guild-config');
test('GUILD_ID fetches exactly the configured guild even if not cached',async()=>{
 const guild={id:'1538393098185613352'};
 const client={guilds:{cache:new Map(),fetch:async id=>{assert.equal(id,guild.id);return guild;}}};
 assert.deepEqual(await commandGuilds(client,{GUILD_ID:' 1538393098185613352 '}),[guild]);
 await assert.rejects(commandGuilds(client,{GUILD_ID:'invalid'}),/numeric/);
 await assert.rejects(commandGuilds({guilds:{fetch:async()=>{throw Error('Missing');}}},{GUILD_ID:guild.id}),/cannot access/);
});
test('unset GUILD_ID preserves existing all-guild registration',async()=>{
 const guild={id:'guild'};assert.deepEqual(await commandGuilds({guilds:{cache:new Map([['guild',guild]])}},{}),[guild]);
});
