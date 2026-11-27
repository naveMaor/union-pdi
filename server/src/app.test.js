
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

// Regression: a human tester hit a real-browser CORS failure — DELETE /api/vehicles/:id/blocker
// preflight rejected because @fastify/cors defaults to GET,HEAD,POST when `methods` is unset.
test('CORS preflight allows DELETE and PUT from the configured frontend origin', async () => {
  const app = buildApp();

  try {
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/vehicles/PDI-001/blocker',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type,x-demo-role'
        }
      });

      assert.equal(response.statusCode, 204, `preflight for ${method} should succeed`);
      assert.ok(
        response.headers['access-control-allow-methods']?.includes(method),
        `Access-Control-Allow-Methods should include ${method}, got: ${response.headers['access-control-allow-methods']}`
      );
      assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
    }
  } finally {
    await app.close();
  }
});
