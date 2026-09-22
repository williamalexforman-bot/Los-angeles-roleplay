const test=require('node:test'),assert=require('node:assert/strict'),D=require('discord.js');
const {GUILD_ID,CHANNELS,ROLES,TICKETS,TICKET_DESCRIPTIONS}=require('../src/settings');
test('new server destinations and roles are isolated from the previous server',()=>{
 assert.equal(GUILD_ID,'1521385783477407847');
 const expected={welcome:'1521502153942892687',ticketPanel:'1545944377019596800',tickets_general:'1521385784622579726',tickets_affairs:'1521385784622579725',tickets_high:'1521588452041294066',infractions:'1521385785020907600',promotions:'1521385785020907599',transcripts:'1521385785532878911',log_bot:'1521385785532878913'};
 for(const [key,id]of Object.entries(expected))assert.equal(CHANNELS[key],id);
 assert.deepEqual(ROLES.warnings,[]);assert.deepEqual(ROLES.strikes,[]);assert.ok(Object.values(ROLES).filter(v=>!Array.isArray(v)).every(v=>v===null));
});
test('registration remains valid and ticket destinations fit Discord command limits',()=>{
 const commands=require('../src/commands/config').commands.map(c=>c.toJSON());
 assert.ok(commands.some(c=>c.name==='ticketpanel'));const config=commands.find(c=>c.name==='config');
 assert.equal(config.options.find(o=>o.name==='channel').options.find(o=>o.name==='destination').autocomplete,true);
 const {parsePrefix}=require('../src/messages');for(const command of ['deployment','close','closerequest','ticketpanel'])assert.equal(parsePrefix('-'+command).command,command);
});
test('CPFR ticket launcher offers the three supplied departments',()=>{
 const p=require('../src/panels').panel('ticket'),box=p.components[0].toJSON(),menu=box.components.find(c=>c.type===1).components[0];
 assert.equal(p.flags,D.MessageFlags.IsComponentsV2);assert.deepEqual(menu.options.map(o=>o.label),['General Support','Internal Affairs','Office of the Chief']);
 for(const o of menu.options)assert.equal(o.description,TICKET_DESCRIPTIONS[o.value]);
});
test('new department panels use banners and resolve leadership into user mentions',()=>{
 const members=new D.Collection([
  ['101',{id:'1500000000000000101',displayName:'FR101 | M. Smith',user:{username:'chief'}}],
  ['102',{id:'1500000000000000102',displayName:'FR102 | C. Thundercock',user:{username:'deputy'}}],
  ['103',{id:'1500000000000000103',displayName:'FR103 | D. Love',user:{username:'assistant-one'}}],
  ['104',{id:'1500000000000000104',displayName:'FR104 | J.kripe',user:{username:'assistant-two'}}],
 ]);
 const panels=require('../src/department-panels');
 const info=panels.get('information',{members:{cache:members}}),serialized=JSON.stringify(info.components.map(component=>component.toJSON()));
 for(const member of members.values())assert.match(serialized,new RegExp(`<@${member.id}>`));
 assert.deepEqual(info.allowedMentions.users,[...members.values()].map(member=>member.id));
 const regulations=JSON.stringify(panels.get('regulations').components.map(component=>component.toJSON()));
 assert.match(regulations,/regulations\.png/);
 const assistance=JSON.stringify(panels.get('ticket').components.map(component=>component.toJSON()));
 assert.match(assistance,/What Happens Next/);
});
test('each department routes into its supplied ticket destination',async()=>{
 const {ticketCategory}=require('../src/tickets');const ids={general:CHANNELS.tickets_general,affairs:CHANNELS.tickets_affairs,high:CHANNELS.tickets_high};
 for(const [type,id]of Object.entries(ids)){const category={id,type:D.ChannelType.GuildCategory};const guild={channels:{fetch:async actual=>{assert.equal(actual,id);return category;}}};assert.equal(await ticketCategory(guild,CHANNELS,type),category);}
});
