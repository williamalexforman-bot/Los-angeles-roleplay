const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('discord.js');
const { discordId, robloxAccount, execute, CHANNEL_ID } = require('../src/mostwanted');
const { MANAGER } = require('../src/access');
const target = '123456789012345678';
const account = { id: 156, name: 'Builderman', displayName: 'Builderman' };
const imageUrl = 'https://tr.rbxcdn.com/example/420/420/Avatar/Png';
const response = data => ({ ok: true, json: async () => ({ data }) });
const lookup = async url => response(url.includes('usernames') ? [account] : [{ targetId: 156, state: 'Completed', imageUrl }]);

test('Discord option accepts external IDs and mentions without a member lookup', () => {
  for (const input of [target, `<@${target}>`, `<@!${target}>`]) assert.equal(discordId(input), target);
  for (const input of ['username', '@everyone', `<@${target}`, `${target}>`]) assert.throws(() => discordId(input), /Discord user ID/);
  const command = require('../src/commands/config').commands.find(c => c.name === 'mostwanted').toJSON();
  assert.equal(command.options.find(o => o.name === 'discord').type, D.ApplicationCommandOptionType.String);
  assert.ok(command.options.every(o => o.required));
});

test('Roblox lookup resolves canonical identity and retries a pending avatar', async () => {
  let calls = 0, pauses = 0;
  const result = await robloxAccount('builderman', async (url, options) => {
    assert.ok(options.signal);
    if (url.includes('usernames')) {
      assert.deepEqual(JSON.parse(options.body), { usernames: ['builderman'], excludeBannedUsers: false });
      return response([account]);
    }
    return response([{ targetId: 156, state: ++calls === 1 ? 'Pending' : 'Completed', imageUrl }]);
  }, async () => pauses++);
  assert.equal(result.name, 'Builderman'); assert.equal(result.avatar, imageUrl); assert.equal(pauses, 1);
});

test('Roblox errors fail clearly without substituting another avatar', async () => {
  await assert.rejects(robloxAccount('missing', async () => response([])), /No Roblox account/);
  await assert.rejects(robloxAccount('builderman', async () => ({ ok: false, status: 429 })), /rate limiting/);
  await assert.rejects(robloxAccount('builderman', async () => { throw Error('network'); }), /could not connect/);
  for (const state of ['Blocked', 'Pending']) {
    await assert.rejects(robloxAccount('builderman', async url => response(url.includes('usernames') ? [account] : [{ targetId: 156, state }]), async () => {}), /No notice was posted/);
  }
});

function interaction({ access = true, permissions = true } = {}) {
  const sent = [];
  const i = {
    id: '111111111111111111', user: { id: '222222222222222222' },
    options: { getString: name => ({ roblox: 'builderman', discord: target, reason: 'Test reason @everyone' })[name] },
    deferReply: async () => {}, editReply: async p => { i.reply = p; },
    guild: {
      members: { fetch: async ({ user }) => { assert.equal(user, i.user.id); return { roles: { cache: new Set(access ? [MANAGER] : []) } }; }, fetchMe: async () => ({}) },
      channels: { fetch: async id => { assert.equal(id, CHANNEL_ID); return {
        type: D.ChannelType.GuildText, permissionsFor: () => ({ has: () => permissions }),
        send: async p => { sent.push(p); return { url: 'https://discord.com/channels/server/channel/message' }; },
      }; } },
    },
  };
  return { i, sent };
}

test('notice posts avatar, reason and external Discord ID only in the requested channel', async () => {
  const { i, sent } = interaction(); await execute(i, lookup);
  assert.equal(sent.length, 1);
  const payload = sent[0], body = JSON.stringify(payload.components);
  for (const value of [target, 'Builderman', imageUrl, 'Test reason', 'https://www.roblox.com/users/156/profile']) assert.ok(body.includes(value));
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.nonce, i.id); assert.equal(payload.enforceNonce, true);
  assert.ok(payload.flags & D.MessageFlags.IsComponentsV2); assert.ok(i.reply);
});

test('unauthorized users, missing permissions and lookup failures cannot publish', async () => {
  for (const [options, request, pattern] of [
    [{ access: false }, lookup, /need/],
    [{ permissions: false }, lookup, /Embed Links/],
    [{}, async () => response([]), /No Roblox account/],
  ]) {
    const { i, sent } = interaction(options);
    await assert.rejects(execute(i, request), pattern); assert.equal(sent.length, 0);
  }
});
