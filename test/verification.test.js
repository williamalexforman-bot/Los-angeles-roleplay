const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('discord.js');
const store = require('../src/store');
const V = require('../src/verification');
const request = async () => ({ ok: true, json: async () => ({ data: [{ id: 156, name: 'builderman' }] }) });
function interaction() {
  const updates = [];
  const member = { nickname: null, manageable: true, setNickname: async name => updates.push(name) };
  const i = { inGuild: () => true, channelId: V.CHANNEL_ID, customId: V.MODAL_ID, user: { id: 'member' },
    isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => 'Builderman' },
    deferReply: async p => { assert.equal(p.flags, D.MessageFlags.Ephemeral); }, editReply: async p => { i.reply = p; },
    guild: { members: { fetch: async args => { assert.equal(args.user, 'member'); return member; }, fetchMe: async () => ({ permissions: { has: () => true } }) } },
  };
  return { i, member, updates };
}
test('verification button opens a Roblox username modal', async () => {
  const { i } = interaction(); i.customId = V.BUTTON_ID; i.isButton = () => true;
  i.showModal = async modal => { const data = modal.toJSON(); assert.equal(data.custom_id, V.MODAL_ID); assert.equal(data.components[0].components[0].custom_id, 'roblox'); };
  await V.handle(i);
});
test('verified Roblox spelling becomes only the invoking member nickname', async () => {
  const { i, updates } = interaction(); await V.handle(i, request);
  assert.deepEqual(updates, ['builderman']); assert.ok(i.reply);
});
test('missing Roblox accounts and role hierarchy failures do not change nicknames', async () => {
  const { i, member, updates } = interaction();
  await assert.rejects(V.handle(i, async () => ({ ok: true, json: async () => ({ data: [] }) })), /No Roblox account/);
  member.manageable = false;
  await assert.rejects(V.handle(i, request), /cannot change your nickname/);
  assert.deepEqual(updates, []); assert.equal(i.reply, undefined);
});
test('already synced names succeed without an unnecessary Discord mutation', async () => {
  const { i, member, updates } = interaction(); member.nickname = 'builderman'; member.manageable = false;
  await V.handle(i, request); assert.deepEqual(updates, []); assert.ok(i.reply);
});
test('panel posting persists, reuses and recovers deleted messages without ignoring read failures', async () => {
  let record, sent = 0, recent = [], existing, failure;
  store.locked = async (_key, work) => work();
  store.collection = () => ({ findOne: async () => record, updateOne: async (_filter, update) => { record = update.$set; } });
  const message = { id: 'message', author: { id: 'bot' }, components: V.panel().components };
  const channel = { type: D.ChannelType.GuildText, guildId: process.env.GUILD_ID || '1538371050759520306',
    messages: { fetch: async arg => { if (failure) throw failure; if (typeof arg === 'string') { if (!existing) throw { code: 10008 }; return existing; } return new D.Collection(recent.map(m => [m.id, m])); } },
    send: async () => { sent++; existing = message; return message; },
  };
  const client = { user: { id: 'bot' }, channels: { fetch: async id => { assert.equal(id, V.CHANNEL_ID); return channel; } } };
  await V.ensurePanel(client); await V.ensurePanel(client); assert.equal(sent, 1);
  record = undefined; recent = [message]; await V.ensurePanel(client); assert.equal(sent, 1);
  existing = null; recent = []; await V.ensurePanel(client); assert.equal(sent, 2);
  failure = { code: 50013 }; await assert.rejects(V.ensurePanel(client)); assert.equal(sent, 2);
});
