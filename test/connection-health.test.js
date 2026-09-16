const test = require('node:test');
const assert = require('node:assert/strict');
const { botToken, connectionHealth } = require('../src/connection-health');

test('Render BOT_TOKEN takes priority and preserves lowercase compatibility', () => {
  assert.equal(botToken({ BOT_TOKEN: ' primary ', bot_token: 'old' }), 'primary');
  assert.equal(botToken({ BOT_TOKEN: ' ', bot_token: ' old ' }), 'old');
  assert.equal(botToken({}), '');
});

test('stalled initial login restarts once after the grace period', () => {
  let time = 0, restarts = 0;
  const health = connectionHealth({ isReady: () => false, now: () => time, restart: () => restarts++ });
  time = 119999; assert.equal(health.check(), false); assert.equal(restarts, 0);
  time = 120000; health.check(); health.check(); assert.equal(restarts, 1);
});

test('normal reconnects recover, and later outages get a fresh grace period', () => {
  let time = 0, ready = true, restarts = 0;
  const health = connectionHealth({ isReady: () => ready, now: () => time, restart: () => restarts++ });
  health.check();
  time = 500000; ready = false; health.check(); assert.equal(restarts, 0);
  time += 110000; ready = true; assert.equal(health.check(), true);
  time += 500000; ready = false; health.check(); assert.equal(restarts, 0);
  time += 120000; health.check(); assert.equal(restarts, 1);
});
