const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const S=require('../src/settings'),{allowed}=require('../src/access');
test('PCSO destinations and supplied marker roles are exact',()=>{
 assert.equal(S.GUILD_ID,'1521905971004444743');
 assert.deepEqual([S.CHANNELS.welcome,S.CHANNELS.deployment,S.CHANNELS.infractions,S.CHANNELS.promotions],['1521905971885248734','1549277165617549382','1521905972430241913','1521905972128256240']);
 assert.deepEqual([S.CHANNELS.tickets_general,S.CHANNELS.tickets_affairs,S.CHANNELS.tickets_high],['1521905971717210155','1521905971717210157','1521905971717210158']);
 assert.deepEqual(S.ROLES.strikes,['1543551522716262450','1543551599228751902']);
 assert.equal(S.ROLES.termination,S.ROLES.warnings[0]);assert.equal(S.ROLES.suspended,'1544510578913968148');
 assert.equal(S.ROLES.blacklisted,'1540811483955335358');assert.equal(S.ROLES.investigation,'1544815910802427944');
});
test('removed features have no commands or prefix routes',()=>{
 const commands=require('../src/commands/config').commands.map(c=>c.toJSON());
 for(const name of ['applicationpanel','mostwanted','spamcool']){
  assert.ok(!commands.some(c=>c.name===name));assert.equal(require('../src/messages').parsePrefix('-'+name),null);
 }
 const choices=commands.find(c=>c.name==='config').options.find(o=>o.name==='channel').options[0].choices;
 assert.ok(choices.length<=25);
});
test('ordinary members get no access without configured roles; administrators do',()=>{
 assert.equal(allowed({roles:{cache:new Set()}},'infraction'),false);
 assert.equal(allowed({id:'u',permissions:{has:()=>true}},'promotion'),true);
 assert.equal(allowed({id:'u',roles:{cache:new Set(['staff'])}},'infraction',{role_infraction:'staff'}),true);
 assert.equal(allowed({id:'u',roles:{cache:new Set(['staff'])}},'promotion',{role_infraction:'staff'}),false);
});
test('ticket destinations resolve per department, including text parents',async()=>{
 const {ticketCategory}=require('../src/tickets');const category={id:'cat',type:D.ChannelType.GuildCategory};
 const guild={channels:{fetch:async id=>id==='cat'?category:{type:D.ChannelType.GuildText,parent:id==='text'?category:null}}};
 assert.equal(await ticketCategory(guild,{tickets_general:'cat'},'general'),category);
 assert.equal(await ticketCategory(guild,{tickets_affairs:'text'},'affairs'),category);
 assert.equal(await ticketCategory(guild,{tickets_high:'root-text'},'high'),null);
 await assert.rejects(ticketCategory(guild,{},'high'),/destination/);
});
test('server emoji aliases resolve without matching restricted or unrelated artwork',()=>{
 const E=require('../src/panel-emojis');const emojis=new D.Collection([
 ['1',{id:'1',name:'promotions'}],['2',{id:'2',name:'PCSO_OPS'}],['3',{id:'3',name:'close',available:false}],['4',{id:'4',name:'infraction',roles:{cache:new Set(['restricted'])}}]
 ]);
 E.configure({guilds:{cache:new D.Collection([[S.GUILD_ID,{emojis:{cache:emojis}}]])}});
 assert.equal(E.find('promotion',S.GUILD_ID).id,'1');assert.equal(E.find('internal_affairs',S.GUILD_ID).id,'2');
 assert.equal(E.icon('close','🔒',S.GUILD_ID),'🔒');assert.equal(E.find('infraction',S.GUILD_ID),undefined);E.configure(null);
});
