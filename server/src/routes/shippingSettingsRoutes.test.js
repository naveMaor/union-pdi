'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_task4_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('task4') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run shippingSettingsRoutes.test.js: resolved test database "${TEST_DB}" does not look like an isolated task4-test database`
);

function adminClient() {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: 'postgres',
  });
}

async function dropTestDatabase() {
  const client = adminClient();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await client.end();
}

let db;
let buildApp;
let seed;
let app;

before(async () => {
  const client = adminClient();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await client.query(`CREATE DATABASE "${TEST_DB}"`);
  await client.end();

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

beforeEach(async () => {
  await db.sequelize.query(
    'DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM audit_events;'
  );
  await db.ShippingCapacity.update({ capacity: 65 }, { where: {} });
  await db.Setting.update({ daily_capacity: 200 }, { where: { id: 1 } });
  await db.BrandQuota.update({ quota_target: 32 }, { where: { brand: 'Geely' } });
  app = buildApp();
});

async function inject(opts) {
  return app.inject(opts);
}

function withRole(role, opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), 'x-demo-role': role } };
}

async function getPendingShippingBaseline() {
  const gen = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(gen.statusCode, 200);
  const submit = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submit.statusCode, 200);
  return gen.json();
}

test('SPEC section 14 test 9: capacity 45 at נמל חיפה (52 in plan) blocks approval; return without comment rejected; with comment succeeds', async () => {
  const baseline = await getPendingShippingBaseline();

  const setCapacity = await inject(
    withRole('ADMIN', {
      method: 'PUT',
      url: '/api/settings',
      payload: { shippingCapacities: { 'נמל חיפה': 45 } },
    })
  );
  assert.equal(setCapacity.statusCode, 200);

  const approveRes = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveRes.statusCode, 409);
  assert.equal(approveRes.json().error, 'SHIPPING_CAPACITY_EXCEEDED');

  const returnNoComment = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/return', payload: {} }));
  assert.equal(returnNoComment.statusCode, 400);
  assert.equal(returnNoComment.json().error, 'COMMENT_REQUIRED');

  const returnWithComment = await inject(
    withRole('SHIPPING', { method: 'POST', url: '/api/plan/return', payload: { comment: 'חריגה בנמל חיפה' } })
  );
  assert.equal(returnWithComment.statusCode, 200);
  assert.equal(returnWithComment.json().plan.status, 'RETURNED');

  const summary = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan' }));
  assert.equal(summary.json().plan.returned_note, 'חריגה בנמל חיפה');

  const planRow = await db.Plan.findByPk(baseline.plan.id);
  assert.equal(planRow.status, 'RETURNED');
});

test('approve/return role-gated to SHIPPING only', async () => {
  await getPendingShippingBaseline();

  const approveAsPlanner = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveAsPlanner.statusCode, 403);

  const approveAsAdmin = await inject(withRole('ADMIN', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveAsAdmin.statusCode, 403);

  const returnAsPlanner = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/return', payload: { comment: 'x' } })
  );
  assert.equal(returnAsPlanner.statusCode, 403);
});

test('approval succeeds when all 4 sources are within capacity', async () => {
  await getPendingShippingBaseline();

  const res = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().plan.status, 'APPROVED');
});

test('APPROVED is final: every mutating operation is rejected server-side', async () => {
  await getPendingShippingBaseline();
  const approveRes = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveRes.statusCode, 200);

  const attempts = [
    withRole('PLANNER', { method: 'POST', url: '/api/plan/vehicles/PDI-001/exclude', payload: { reasonCode: 'OPERATIONAL_DELAY' } }),
    withRole('PLANNER', { method: 'POST', url: '/api/plan/vehicles/PDI-001/cancel-exclusion' }),
    withRole('PLANNER', { method: 'POST', url: '/api/plan/replacement/confirm', payload: { vehicleId: 'PDI-001' } }),
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } }),
    withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }),
    withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }),
    withRole('SHIPPING', { method: 'POST', url: '/api/plan/return', payload: { comment: 'x' } }),
  ];

  for (const opts of attempts) {
    const res = await inject(opts);
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${opts.method} ${opts.url} should be rejected (4xx), got ${res.statusCode}`);
  }

  const planVehicleCount = await db.PlanVehicle.count();
  assert.equal(planVehicleCount, 200, 'APPROVED plan membership must be completely unchanged');
});

test('blocker add/remove on an APPROVED plan member still succeeds (warning-only), without altering membership or status', async (t) => {
  const baseline = await getPendingShippingBaseline();
  const approveRes = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveRes.statusCode, 200);
  t.after(() => db.Vehicle.update({ active_blocker: 'NONE' }, { where: { vehicle_id: 'PDI-001' } }));

  const addRes = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/vehicles/PDI-001/blocker', payload: { blockerCode: 'RECALL' } })
  );
  assert.equal(addRes.statusCode, 200);

  const stillMember = await db.PlanVehicle.findOne({ where: { plan_id: baseline.plan.id, vehicle_id: 'PDI-001' } });
  assert.ok(stillMember, 'blocker must not remove the vehicle from an APPROVED plan');

  const planRow = await db.Plan.findByPk(baseline.plan.id);
  assert.equal(planRow.status, 'APPROVED', 'blocker must not change plan status');

  const summary = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan' }));
  assert.ok(summary.json().blockerWarnings.some((w) => w.vehicle_id === 'PDI-001'));
});

test('settings: GET open to any valid demo role, PUT gated to ADMIN only', async () => {
  const getAsPlanner = await inject(withRole('PLANNER', { method: 'GET', url: '/api/settings' }));
  assert.equal(getAsPlanner.statusCode, 200, 'GET must be readable by PLANNER (needs envelope thresholds for its own display)');
  assert.equal(getAsPlanner.json().dailyCapacity, 200);

  const getAsShipping = await inject(withRole('SHIPPING', { method: 'GET', url: '/api/settings' }));
  assert.equal(getAsShipping.statusCode, 200, 'GET must be readable by SHIPPING (needs shipping capacities for its own display)');

  const putAsShipping = await inject(
    withRole('SHIPPING', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 150 } })
  );
  assert.equal(putAsShipping.statusCode, 403, 'PUT must remain ADMIN-only');

  const putAsPlanner = await inject(
    withRole('PLANNER', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 150 } })
  );
  assert.equal(putAsPlanner.statusCode, 403, 'PUT must remain ADMIN-only');

  const getAsAdmin = await inject(withRole('ADMIN', { method: 'GET', url: '/api/settings' }));
  assert.equal(getAsAdmin.statusCode, 200);
  assert.equal(getAsAdmin.json().dailyCapacity, 200);
});

test('settings: invalid values rejected server-side with 400, valid updates persist', async () => {
  const cases = [
    { dailyCapacity: 0 },
    { dailyCapacity: -5 },
    { dailyCapacity: 1.5 },
    { envelopeYellowThresholdDays: -1 },
    { brandQuotas: { NotARealBrand: { quota_target: 10, quota_type: 'HARD' } } },
    { brandQuotas: { Toyota: { quota_target: -1, quota_type: 'HARD' } } },
    { brandQuotas: { Toyota: { quota_target: 10, quota_type: 'BOGUS' } } },
    { shippingCapacities: { 'לא מקום אמיתי': 10 } },
    { shippingCapacities: { 'נמל אשדוד': -1 } },
  ];

  for (const payload of cases) {
    const res = await inject(withRole('ADMIN', { method: 'PUT', url: '/api/settings', payload }));
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(payload)}`);
    assert.equal(res.json().error, 'INVALID_SETTING_VALUE');
  }

  const validUpdate = await inject(
    withRole('ADMIN', {
      method: 'PUT',
      url: '/api/settings',
      payload: { dailyCapacity: 180, brandQuotas: { Geely: { quota_target: 40, quota_type: 'FLEX' } } },
    })
  );
  assert.equal(validUpdate.statusCode, 200);
  assert.equal(validUpdate.json().dailyCapacity, 180);
  assert.equal(validUpdate.json().brandQuotas.Geely.quota_target, 40);

  const reread = await inject(withRole('ADMIN', { method: 'GET', url: '/api/settings' }));
  assert.equal(reread.json().dailyCapacity, 180);
  assert.equal(reread.json().brandQuotas.Geely.quota_target, 40);
});

test('settings changes do not retroactively affect an existing plan, but a subsequent regeneration picks up the new values', async () => {
  const baseline = await getPendingShippingBaseline();
  // baseline is PENDING_SHIPPING now (submitted); return it so it's editable again for the regen step
  await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/return', payload: { comment: 'testing non-retroactivity' } }));

  const beforeUpdate = await db.Plan.findByPk(baseline.plan.id);
  assert.equal(beforeUpdate.capacity_snapshot, 200);
  const beforeMembershipCount = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });
  assert.equal(beforeMembershipCount, 200);

  await inject(withRole('ADMIN', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 195 } }));

  const unchanged = await db.Plan.findByPk(baseline.plan.id);
  assert.equal(unchanged.capacity_snapshot, 200, 'existing plan snapshot must not change from a settings update alone');
  const unchangedMembershipCount = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });
  assert.equal(unchangedMembershipCount, 200, 'existing plan membership must not change from a settings update alone');

  const regen = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } })
  );
  assert.equal(regen.statusCode, 200);
  assert.equal(regen.json().plan.capacity_snapshot, 195);
  assert.equal(regen.json().selected.length, 195);
});

test('two near-simultaneous approve calls on the same PENDING_SHIPPING plan serialize via the advisory lock', async () => {
  await getPendingShippingBaseline();

  const results = await Promise.allSettled([
    inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' })),
    inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' })),
  ]);

  const statusCodes = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 'rejected')).sort();
  assert.deepEqual(statusCodes, [200, 409], 'exactly one approve call should succeed, the other should see the already-approved plan');

  const approvedCount = await db.Plan.count({ where: { status: 'APPROVED' } });
  assert.equal(approvedCount, 1);
  const transitionEvents = await db.AuditEvent.count({ where: { event_type: 'STATUS_TRANSITION', payload: { [db.Sequelize.Op.contains]: { to: 'APPROVED' } } } });
  assert.equal(transitionEvents, 1, 'only one APPROVED STATUS_TRANSITION audit row should exist, not two');
});

test('audit events: SETTINGS_CHANGED and STATUS_TRANSITION (approve/return) recorded with correct actor and before/after values', async () => {
  await inject(withRole('ADMIN', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 190 } }));
  const settingsEvent = await db.AuditEvent.findOne({ where: { event_type: 'SETTINGS_CHANGED' } });
  assert.equal(settingsEvent.actor_name, 'רונית שמש');
  assert.equal(settingsEvent.actor_role, 'ADMIN');
  const dailyCapChange = settingsEvent.payload.changes.find((c) => c.setting === 'daily_capacity_and_thresholds');
  assert.equal(dailyCapChange.before.daily_capacity, 200);
  assert.equal(dailyCapChange.after.daily_capacity, 190);

  await getPendingShippingBaseline();
  const approveRes = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/approve' }));
  assert.equal(approveRes.statusCode, 200);

  const approveEvent = await db.AuditEvent.findOne({ where: { event_type: 'STATUS_TRANSITION' }, order: [['id', 'DESC']] });
  assert.equal(approveEvent.actor_name, 'יוסי כהן');
  assert.equal(approveEvent.actor_role, 'SHIPPING');
  assert.deepEqual(approveEvent.payload, { from: 'PENDING_SHIPPING', to: 'APPROVED' });
});
