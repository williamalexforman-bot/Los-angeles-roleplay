const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('discord.js');
const { commands } = require('../src/commands/config');
const { pages, handle, PREFIX_COMMANDS } = require('../src/command-help');

test('help includes every registered command and subcommand plus prefix commands', () => {
  const payloads = pages(), text = JSON.stringify(payloads);
  for (const builder of commands) {
    const command = builder.toJSON();
    assert.ok(text.includes(`/${command.name}`));
    for (const sub of (command.options || []).filter(o => o.type === D.ApplicationCommandOptionType.Subcommand)) assert.ok(text.includes(`/${command.name} ${sub.name}`));
  }
  for (const [usage] of PREFIX_COMMANDS) assert.ok(text.includes(usage));
  assert.ok(text.includes('[evidence:value]'));
  for (const payload of payloads) {
    assert.equal(payload.flags & D.MessageFlags.Ephemeral, 0);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    const container = payload.components[0].toJSON();
    const displays = container.components.filter(c => c.type === D.ComponentType.TextDisplay);
    assert.ok(displays.every(c => c.content.length <= 4000));
    assert.ok(displays.reduce((sum, c) => sum + c.content.length, 0) <= 4000);
  }
});

test('cmds replies with all pages publicly without requiring staff access', async () => {
  const sent = [];
  await handle({ reply: async payload => sent.push(payload), followUp: async payload => sent.push(payload) });
  assert.equal(sent.length, pages().length); assert.ok(sent.length > 0);
});
