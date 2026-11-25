
const { test } = require('node:test');
const assert = require('node:assert/strict');
const buildApp = require('./app');

test('GET /ping returns a healthy response', async () => {
  const app = buildApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ping'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'ok');
  } finally {
    await app.close();
  }
});
