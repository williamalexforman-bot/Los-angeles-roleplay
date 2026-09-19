const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const {GUILD_ID,CHANNELS,ROLES,TICKETS,TICKET_DESCRIPTIONS}=require('../src/settings');
test('new server destinations and all supplied roles are exact',()=>{
 assert.equal(GUILD_ID,'1536150657440948324');
 assert.deepEqual(ROLES.warnings,['1550972697830367263','1550972751496487102']);assert.deepEqual(ROLES.strikes,['1550972916005478562','1550972965363912754']);
 assert.deepEqual([ROLES.suspended,ROLES.termination,ROLES.blacklisted],['1550973028114890752','1550973091000090655','1550973143785410650']);
 const expected={ticketPanel:'1536201127950024714',tickets:'1548331533197115563',infractions:'1539959958903455815',promotions:'1539959822680592415',log_bot:'1548066902629294131',transcripts:'1536274703050612797',log_claims:'1536274703050612797',log_tickets:'1536274703050612797',log_infractions:'1544603710192357387',appeals:'1544620247527465040'};
 for(const [key,id] of Object.entries(expected))assert.equal(CHANNELS[key],id);
 assert.equal(CHANNELS.welcome,null);assert.equal(CHANNELS.deployment,null);
});
test('registration and prefix routing expose only retained systems',()=>{
 const commands=require('../src/commands/config').commands.map(c=>c.toJSON());
 assert.deepEqual(commands.map(c=>c.name),['config','infraction','promotion','suspension','deployment','close','closerequest','ticketpanel','cmds']);
 assert.deepEqual(commands[0].options.find(o=>o.name==='panel').options[0].choices.map(c=>c.value),['ticket']);
 const {parsePrefix}=require('../src/messages');
 for(const command of ['say','purge','shift','quota','arrestreport','mostwanted','spamcool','verificationpanel','applicationpanel','add emojis','force delete','force stop emojis'])assert.equal(parsePrefix('-'+command),null);
 for(const command of ['deployment','close','closerequest','ticketpanel'])assert.equal(parsePrefix('-'+command).command,command);
});
test('bannerless V2 ticket launcher has all five requested categories and descriptions',()=>{
 const p=require('../src/panels').panel('ticket'),box=p.components[0].toJSON();
 assert.equal(p.flags,D.MessageFlags.IsComponentsV2);assert.equal(box.type,17);
 const menu=box.components.find(c=>c.type===1).components[0];
 assert.deepEqual(menu.options.map(o=>o.label),['General Support','OPR Report','Divisional Inquiries','HR Support','Recruitment Support']);
 for(const o of menu.options)assert.equal(o.description,TICKET_DESCRIPTIONS[o.value]);
 assert.ok(!JSON.stringify(box).includes('https://'));
 const opening=require('../src/legacy-layout').ticketNotice({_id:'ticket',owner:'u',type:'division',reason:'Help',guildId:GUILD_ID}).components[0].toJSON();
 const controls=opening.components.find(c=>c.type===1).components;
 assert.deepEqual(controls.map(c=>c.custom_id),['ticket:claim','ticket:close','ticket:escalate']);
 assert.ok(JSON.stringify(opening).includes('Divisional Inquiries'));
});
test('all five departments use the shared private-ticket category',async()=>{
 const {ticketCategory}=require('../src/tickets');
 for(const type of Object.keys(TICKETS)){
  const category={id:CHANNELS.tickets,type:D.ChannelType.GuildCategory};
  const guild={channels:{fetch:async id=>{assert.equal(id,CHANNELS.tickets);return category;}}};
  assert.equal(await ticketCategory(guild,CHANNELS,type),category);
 }
});
test('ticketpanel posts to configured destination, not the invocation channel',async()=>{
 const access=require('../src/access'),discipline=require('../src/discipline'),delivery=require('../src/config-delivery');
 const originals=[access.requireAccess,discipline.destination,delivery.sendPanel];
 access.requireAccess=async()=>{};discipline.destination=async(_g,key)=>{assert.equal(key,'ticketPanel');return {id:CHANNELS.ticketPanel};};
 let sent=false;delivery.sendPanel=async(c,_g,p)=>{assert.equal(c.id,CHANNELS.ticketPanel);assert.ok(p.flags&D.MessageFlags.IsComponentsV2);sent=true;};
 const path=require.resolve('../src/utilities'),prior=require.cache[path];delete require.cache[path];
 try{await require('../src/utilities').execute({guild:{},channel:{send:()=>assert.fail('Wrong destination')}},'ticketpanel');assert.equal(sent,true);}
 finally{[access.requireAccess,discipline.destination,delivery.sendPanel]=originals;delete require.cache[path];if(prior)require.cache[path]=prior;}
});
