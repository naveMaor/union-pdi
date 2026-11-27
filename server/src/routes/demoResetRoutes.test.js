'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_demoreset_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('demoreset') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run demoResetRoutes.test.js: resolved test database "${TEST_DB}" does not look like an isolated demo-reset-test database`
);

const TEST_TOKEN = 'x'.repeat(40);

function adminClient(database = 'postgres') {
  return new Client({
    host: config.host, port: config.port, user: config.username, password: config.password, database,
  });
}

async function dropTestDatabase() {
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.end();
}

let db;
let buildApp;
let seed;
let planService;
let blockerService;
let planEditService;

before(async () => {
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  await admin.end();

  try {
    execFileSync('npx', ['sequelize-cli', 'db:migrate'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'ignore',
    });

    db = require('../models');
    assert.equal(db.sequelize.config.database, TEST_DB, 'models connected to an unexpected database');

    seed = require('../scripts/seed');
    buildApp = require('../app');
    planService = require('../services/planService');
    blockerService = require('../services/blockerService');
    planEditService = require('../services/planEditService');

    await seed.run();
  } catch (error) {
    await dropTestDatabase();
    throw error;
  }
});

after(async () => {
  await db.sequelize.close();
  await dropTestDatabase();
});

async function resetBusinessTables() {
  // A cheap, count-level clean slate between tests, not a CSV-accurate
  // restore — tests that care about an individual vehicle's exact original
  // blocker either set it explicitly themselves or verify it via an actual
  // reset run within that same test (which is authoritative, since it
  // restores straight from the CSV).
  await db.sequelize.query(
    'DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM audit_events;' +
      " UPDATE vehicles SET active_blocker = 'NONE' WHERE active_blocker <> 'NONE';"
  );
  await db.ShippingCapacity.update({ capacity: 65 }, { where: {} });
  await db.Setting.update(
    { daily_capacity: 200, envelope_yellow_threshold_days: 9, envelope_red_threshold_days: 14 },
    { where: { id: 1 } }
  );
}

function appWithReset({ enabled = true, token = TEST_TOKEN } = {}) {
  if (enabled) {
    process.env.DEMO_RESET_ENABLED = 'true';
    process.env.DEMO_RESET_TOKEN = token;
  } else {
    delete process.env.DEMO_RESET_ENABLED;
    delete process.env.DEMO_RESET_TOKEN;
  }
  return buildApp();
}

function withRole(role, opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), 'x-demo-role': role } };
}

function resetRequest({ role = 'ADMIN', token = TEST_TOKEN, confirm = 'RESET_DEMO_DATA', omitConfirm = false } = {}) {
  const headers = {};
  if (token !== undefined) headers['x-demo-reset-token'] = token;
  return withRole(role, {
    method: 'POST',
    url: '/api/demo/reset',
    headers,
    payload: omitConfirm ? undefined : { confirm },
  });
}

beforeEach(async () => {
  await resetBusinessTables();
});

test('1. DEMO_RESET_ENABLED unset: the route does not exist at all (404)', async () => {
  const app = appWithReset({ enabled: false });
  const res = await app.inject(resetRequest());
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('2. wrong token is rejected (403 INVALID_RESET_TOKEN), zero rows changed', async () => {
  const app = appWithReset();
  const before14 = await db.Vehicle.count();
  const res = await app.inject(resetRequest({ token: 'definitely-not-the-right-token-000000' }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'INVALID_RESET_TOKEN');
  assert.equal(await db.Vehicle.count(), before14);
  assert.equal(await db.AuditEvent.count(), 0);
  await app.close();
});

test('3. correct token but role is not ADMIN (403 FORBIDDEN_ROLE), zero rows changed', async () => {
  const app = appWithReset();
  const res = await app.inject(resetRequest({ role: 'PLANNER' }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'FORBIDDEN_ROLE');
  assert.equal(await db.AuditEvent.count(), 0);
  await app.close();
});

test('4. correct token/role but missing or wrong confirmation phrase (400 CONFIRMATION_REQUIRED)', async () => {
  const app = appWithReset();
  const missing = await app.inject(resetRequest({ omitConfirm: true }));
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, 'CONFIRMATION_REQUIRED');

  const wrong = await app.inject(resetRequest({ confirm: 'yes please' }));
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error, 'CONFIRMATION_REQUIRED');

  assert.equal(await db.AuditEvent.count(), 0);
  await app.close();
});

test('5. full success path: vehicles/settings/quotas restored, plan state null, exactly one DEMO_RESET audit row', async () => {
  const app = appWithReset();

  // Dirty the database first: generate a plan, add then rely on a blocker,
  // manually exclude a vehicle, and change a setting away from its default.
  await planService.generatePlan({ actorName: 'מיכל לוי', actorRole: 'PLANNER' });
  await blockerService.addBlocker({ actorName: 'מיכל לוי', actorRole: 'PLANNER', vehicleId: 'PDI-001', blockerCode: 'DAMAGE' });
  await planEditService.excludeVehicle({
    actorName: 'מיכל לוי', actorRole: 'PLANNER', vehicleId: 'PDI-002',
    reasonCode: 'OPERATIONAL_DELAY', note: null,
  });
  await db.Setting.update({ daily_capacity: 150 }, { where: { id: 1 } });

  const beforeCsv = seed.parseVehiclesCsv(seed.CSV_PATH);
  const originalBlockerById = Object.fromEntries(beforeCsv.map((v) => [v.vehicle_id, v.active_blocker]));

  const res = await app.inject(resetRequest());
  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  assert.equal(res.json().vehicleCount, 300);

  assert.equal(await db.Plan.count(), 0);
  assert.equal(await db.PlanVehicle.count(), 0);
  assert.equal(await db.ManualExclusion.count(), 0);

  const events = await db.AuditEvent.findAll();
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'DEMO_RESET');
  assert.equal(events[0].actor_role, 'ADMIN');

  const vehicle1 = await db.Vehicle.findByPk('PDI-001');
  assert.equal(vehicle1.active_blocker, originalBlockerById['PDI-001']);
  const vehicle2 = await db.Vehicle.findByPk('PDI-002');
  assert.equal(vehicle2.active_blocker, originalBlockerById['PDI-002']);
  assert.equal(await db.Vehicle.count(), 300);

  const settings = await db.Setting.findByPk(1);
  assert.equal(settings.daily_capacity, 200);
  const quotas = await db.BrandQuota.findAll({ raw: true });
  const toyota = quotas.find((q) => q.brand === 'Toyota');
  assert.equal(toyota.quota_target, 55);
  assert.equal(toyota.quota_type, 'HARD');

  await app.close();
});

test('6. rate limit: a second valid reset within the cooldown window is rejected (429 RESET_RATE_LIMITED)', async () => {
  const app = appWithReset();
  const first = await app.inject(resetRequest());
  assert.equal(first.statusCode, 200);

  const second = await app.inject(resetRequest());
  assert.equal(second.statusCode, 429);
  assert.equal(second.json().error, 'RESET_RATE_LIMITED');

  // Still exactly one DEMO_RESET row — the rate-limited attempt did nothing.
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'DEMO_RESET' } }), 1);
  await app.close();
});

test('7. two concurrent reset requests: exactly one succeeds, the other is rejected (409 RESET_IN_PROGRESS)', async () => {
  const app = appWithReset();
  const [a, b] = await Promise.all([app.inject(resetRequest()), app.inject(resetRequest())]);
  const statuses = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);
  const conflictResponse = a.statusCode === 409 ? a : b;
  assert.equal(conflictResponse.json().error, 'RESET_IN_PROGRESS');
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'DEMO_RESET' } }), 1);
  await app.close();
});

test('8. repeated failed token attempts lock out further attempts, even with the correct token (429 TOO_MANY_ATTEMPTS)', async () => {
  const app = appWithReset();
  for (let i = 0; i < 5; i++) {
    const res = await app.inject(resetRequest({ token: 'wrong-token-attempt-number-' + i + '-padded-out' }));
    assert.equal(res.statusCode, 403);
  }
  const lockedOut = await app.inject(resetRequest()); // correct token this time
  assert.equal(lockedOut.statusCode, 429);
  assert.equal(lockedOut.json().error, 'TOO_MANY_ATTEMPTS');
  assert.equal(await db.AuditEvent.count(), 0);
  await app.close();
});

test('9. concurrent business mutation is serialized against a reset, not corrupted by it', async () => {
  const app = appWithReset();

  const [resetResult, blockerResult] = await Promise.allSettled([
    app.inject(resetRequest()),
    blockerService.addBlocker({ actorName: 'מיכל לוי', actorRole: 'PLANNER', vehicleId: 'PDI-003', blockerCode: 'RECALL' }),
  ]);

  assert.equal(resetResult.status, 'fulfilled');
  assert.equal(resetResult.value.statusCode, 200);

  // Whichever order the two transactions actually committed in, the vehicle
  // ends up in one fully consistent, non-corrupted state — either the reset's
  // original CSV value, or the blocker addition on top of it — never a torn
  // write from both interleaving.
  if (blockerResult.status === 'fulfilled') {
    const vehicle = await db.Vehicle.findByPk('PDI-003');
    const csvValue = seed.parseVehiclesCsv(seed.CSV_PATH).find((v) => v.vehicle_id === 'PDI-003').active_blocker;
    assert.ok(vehicle.active_blocker === 'RECALL' || vehicle.active_blocker === csvValue);
  }

  await app.close();
});

test('10. a failure mid-reset leaves no partial state: the whole transaction rolls back', async () => {
  // This is the last test in the file — the whole disposable database is
  // dropped in after() immediately afterward, so dropping a table here
  // needs no cleanup/recreation.
  const app = appWithReset();

  await planService.generatePlan({ actorName: 'מיכל לוי', actorRole: 'PLANNER' });
  const planCountBefore = await db.Plan.count();
  const vehicleCountBefore = await db.Vehicle.count();

  await db.sequelize.query('DROP TABLE audit_events CASCADE');

  const res = await app.inject(resetRequest());
  assert.equal(res.statusCode, 500);

  // Vehicles/plans were updated earlier in the same transaction as the (now
  // failed) final AuditEvent.create — the whole transaction must still have
  // rolled back, leaving the pre-reset state untouched.
  assert.equal(await db.Plan.count(), planCountBefore);
  assert.equal(await db.Vehicle.count(), vehicleCountBefore);

  await app.close();
});
