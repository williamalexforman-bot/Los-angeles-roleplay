const test = require('node:test');
const assert = require('node:assert/strict');
const { healthResponse } = require('../src/health');
test('readiness requires Discord, database and successful command registration', () => {
  for (const missing of ['discord', 'database', 'commands']) {
    const state = { discord: true, database: true, commands: true, [missing]: false };
    for (const path of ['/', '/readyz', '/readyz?monitor=1']) {
      const response = healthResponse(path, state);
      assert.equal(response.statusCode, 503); assert.equal(response.body.ready, false);
    }
    assert.equal(healthResponse('/livez', state).statusCode, 200);
  }
  assert.equal(healthResponse('/readyz', { discord: true, database: true, commands: true }).statusCode, 200);
});
