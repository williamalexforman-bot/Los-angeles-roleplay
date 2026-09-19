const test=require('node:test'),assert=require('node:assert/strict');
const {ticketName,ticketReason}=require('../src/ticket-format');
test('ticket names derive from reason, have safe characters and stay short',()=>{
 assert.equal(ticketName('Report a member!','123456789012345678'),'report-a-member-345678');
 assert.equal(ticketName('😀 !!!','123456'),'support-123456');
 assert.ok(ticketName('a'.repeat(300),'123456').length<=100);
 assert.equal(ticketName('Café\nHelp','123456'),'cafe-help-123456');
});
test('ticket reason remains inline code even with member-supplied backticks and newlines',()=>{
 assert.equal(ticketReason('Help please'),'`Help please`');assert.equal(ticketReason('`test`\nmore'),"`'test' more`");
 const box=require('../src/legacy-layout').ticketNotice({_id:'1',owner:'u',reason:'Help please',type:'general'}).components[0].toJSON();
 assert.ok(JSON.stringify(box).includes('**Reason** `Help please`'));
});
