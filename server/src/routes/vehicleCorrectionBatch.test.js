'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_correction_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('correction') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run vehicleCorrectionBatch.test.js: resolved test database "${TEST_DB}" does not look like an isolated correction-test database`
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
  app = buildApp();
});

async function inject(opts) {
  return app.inject(opts);
}

function withRole(role, opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), 'x-demo-role': role } };
}

async function getAllVehicles() {
  const res = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=all' }));
  assert.equal(res.statusCode, 200);
  return res.json().vehicles;
}

async function readVehicleTabs() {
  const tabs = ['all', 'in_plan', 'eligible_not_in_plan', 'ineligible'];
  const results = await Promise.all(tabs.map(async (tab) => {
    const response = await inject(withRole('PLANNER', { method: 'GET', url: `/api/vehicles?tab=${tab}` }));
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.tab, tab);
    assert.equal(body.count, body.vehicles.length);
    return [tab, body.vehicles];
  }));
  return Object.fromEntries(results);
}

function assertVehicleTabs(tabs, counts, vehicleId, expectedTabs) {
  assert.deepEqual(Object.fromEntries(Object.entries(tabs).map(([tab, rows]) => [tab, rows.length])), counts);
  assert.deepEqual(Object.keys(tabs).filter((tab) =>
    tabs[tab].some((vehicle) => vehicle.vehicle_id === vehicleId)
  ), expectedTabs, `tabs containing ${vehicleId}`);
}

test('pre-generation: tab=eligible_not_in_plan is 262 with reason:null for every vehicle; tab=ineligible stays 38 with the 9/29 split', async () => {
  const eligibleRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=eligible_not_in_plan' }));
  assert.equal(eligibleRes.json().count, 262);
  assert.ok(eligibleRes.json().vehicles.every((v) => v.reason === null), 'no fabricated OVER_CAPACITY/HARD_QUOTA pre-generation');

  const ineligibleRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=ineligible' }));
  assert.equal(ineligibleRes.json().count, 38);
  const reasons = ineligibleRes.json().vehicles.reduce((acc, v) => {
    acc[v.reason] = (acc[v.reason] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(reasons, { NOT_CUSTOMS_RELEASED: 9, ACTIVE_BLOCKER: 29 });
});

test("human's 3 acceptance scenarios: exclusion, cancel-without-regen, and blocker all move the eligible/in-plan tiles exactly as specified", async () => {
  const genRes = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(genRes.statusCode, 200);
  const baselineVehicles = await getAllVehicles();
  assert.equal(baselineVehicles.filter((v) => v.inPlan).length, 200);
  assert.equal(baselineVehicles.filter((v) => !v.exclusion && v.customs_released && v.active_blocker === 'NONE').length, 262);

  const excludeTarget = baselineVehicles.find((v) => v.inPlan).vehicle_id;
  const excludeRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: `/api/plan/vehicles/${excludeTarget}/exclude`,
      payload: { reasonCode: 'OPERATIONAL_DELAY', note: 'בדיקת תרחיש' },
    })
  );
  assert.equal(excludeRes.statusCode, 200);

  const afterExclude = await getAllVehicles();
  assert.equal(afterExclude.filter((v) => v.inPlan).length, 199, 'in-plan count drops by 1 immediately');
  assert.equal(
    afterExclude.filter((v) => !v.exclusion && v.customs_released && v.active_blocker === 'NONE').length,
    261,
    'eligible tile drops to 261 while the exclusion is active'
  );

  // exclusion metadata via a FRESH, independent GET, not the inline exclude response
  const excludedVehicle = afterExclude.find((v) => v.vehicle_id === excludeTarget);
  assert.ok(excludedVehicle.exclusion, 'exclusion metadata must be present on an independent GET /vehicles');
  assert.equal(excludedVehicle.exclusion.reason_code, 'OPERATIONAL_DELAY');
  assert.equal(excludedVehicle.exclusion.note, 'בדיקת תרחיש');
  assert.equal(excludedVehicle.exclusion.excluded_by_name, 'מיכל לוי');
  assert.equal(excludedVehicle.exclusion.excluded_by_role, 'PLANNER');
  assert.ok(excludedVehicle.exclusion.excluded_at);

  const cancelRes = await inject(
    withRole('PLANNER', { method: 'POST', url: `/api/plan/vehicles/${excludeTarget}/cancel-exclusion` })
  );
  assert.equal(cancelRes.statusCode, 200);

  const afterCancel = await getAllVehicles();
  assert.equal(afterCancel.filter((v) => v.inPlan).length, 199, 'cancelling without regenerating must not auto-readd the vehicle');
  assert.equal(
    afterCancel.filter((v) => !v.exclusion && v.customs_released && v.active_blocker === 'NONE').length,
    262,
    'eligible tile returns to 262 immediately after cancellation, no regen needed'
  );
  const cancelledVehicle = afterCancel.find((v) => v.vehicle_id === excludeTarget);
  assert.equal(cancelledVehicle.exclusion, null, 'exclusion metadata must be gone after cancellation');

  const regenRes = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } })
  );
  assert.equal(regenRes.statusCode, 200);
  assert.equal(regenRes.json().selected.length, 200, 'back to 200 after regeneration');

  const afterRegen = await getAllVehicles();
  const blockerTarget = afterRegen.find((v) => v.inPlan).vehicle_id;
  const blockerRes = await inject(
    withRole('PLANNER', { method: 'POST', url: `/api/vehicles/${blockerTarget}/blocker`, payload: { blockerCode: 'RECALL' } })
  );
  assert.equal(blockerRes.statusCode, 200);

  const afterBlocker = await getAllVehicles();
  assert.equal(afterBlocker.filter((v) => v.inPlan).length, 200, 'blocker must not remove the vehicle from the plan');
  assert.equal(
    afterBlocker.filter((v) => !v.exclusion && v.customs_released && v.active_blocker === 'NONE').length,
    261,
    'eligible tile drops to 261 from the blocker alone, independent of plan membership'
  );

  await db.Vehicle.update({ active_blocker: 'NONE' }, { where: { vehicle_id: blockerTarget } });
});

test('exclusion metadata survives a plan regeneration (SPEC 8.2: exclusions are preserved, not cleared)', async () => {
  await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  const baseline = await getAllVehicles();
  const excludeTarget = baseline.find((v) => v.inPlan).vehicle_id;

  await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: `/api/plan/vehicles/${excludeTarget}/exclude`,
      payload: { reasonCode: 'ACCESSORY_ISSUE' },
    })
  );

  await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } }));

  const afterRegen = await getAllVehicles();
  const stillExcluded = afterRegen.find((v) => v.vehicle_id === excludeTarget);
  assert.ok(!stillExcluded.inPlan, 'excluded vehicle must not return after regeneration');
  assert.ok(stillExcluded.exclusion, 'exclusion metadata must still be retrievable after regeneration');
  assert.equal(stillExcluded.exclusion.reason_code, 'ACCESSORY_ISSUE');
});

test('API eligibility tabs follow PDI-195 through exclusion and cancellation without regeneration', async () => {
  const vehicleId = 'PDI-195';
  const generated = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(generated.statusCode, 200);

  assertVehicleTabs(await readVehicleTabs(),
    { all: 300, in_plan: 200, eligible_not_in_plan: 62, ineligible: 38 }, vehicleId, ['all', 'in_plan']);

  const note = 'בדיקת סינון לאחר הוצאה';
  const excluded = await inject(withRole('PLANNER', {
    method: 'POST', url: `/api/plan/vehicles/${vehicleId}/exclude`, payload: { reasonCode: 'OTHER', note },
  }));
  assert.equal(excluded.statusCode, 200);

  const excludedTabs = await readVehicleTabs();
  assertVehicleTabs(excludedTabs,
    { all: 300, in_plan: 199, eligible_not_in_plan: 62, ineligible: 39 }, vehicleId, ['all', 'ineligible']);
  const row = excludedTabs.ineligible.find((vehicle) => vehicle.vehicle_id === vehicleId);
  assert.equal(row.reason, 'MANUALLY_EXCLUDED');
  assert.equal(row.customs_released, true);
  assert.equal(row.active_blocker, 'NONE');
  assert.equal(row.exclusion.reason_code, 'OTHER');
  assert.equal(row.exclusion.note, note);
  assert.equal(row.exclusion.excluded_by_name, 'מיכל לוי');
  assert.equal(row.exclusion.excluded_by_role, 'PLANNER');
  assert.ok(row.exclusion.excluded_at);

  const cancelled = await inject(withRole('PLANNER', { method: 'POST', url: `/api/plan/vehicles/${vehicleId}/cancel-exclusion` }));
  assert.equal(cancelled.statusCode, 200);

  const cancelledTabs = await readVehicleTabs();
  assertVehicleTabs(cancelledTabs,
    { all: 300, in_plan: 199, eligible_not_in_plan: 63, ineligible: 38 }, vehicleId, ['all', 'eligible_not_in_plan']);
  assert.equal(cancelledTabs.eligible_not_in_plan.find((vehicle) => vehicle.vehicle_id === vehicleId).exclusion, null);
});

test('API tabs keep a newly blocked vehicle in the plan while classifying it as ineligible', async () => {
  const vehicleId = 'PDI-023';
  const generated = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(generated.statusCode, 200);
  const baseline = await readVehicleTabs();
  assertVehicleTabs(baseline,
    { all: 300, in_plan: 200, eligible_not_in_plan: 62, ineligible: 38 }, vehicleId, ['all', 'in_plan']);

  const url = `/api/vehicles/${vehicleId}/blocker`;
  const blocked = await inject(withRole('PLANNER', { method: 'POST', url, payload: { blockerCode: 'RECALL' } }));
  assert.equal(blocked.statusCode, 200);

  try {
    const blockedTabs = await readVehicleTabs();
    assertVehicleTabs(blockedTabs,
      { all: 300, in_plan: 200, eligible_not_in_plan: 62, ineligible: 39 },
      vehicleId, ['all', 'in_plan', 'ineligible']);
    const row = blockedTabs.ineligible.find((vehicle) => vehicle.vehicle_id === vehicleId);
    assert.equal(row.inPlan, true);
    assert.equal(row.active_blocker, 'RECALL');
    assert.equal(row.exclusion, null);
  } finally {
    const cleared = await inject(withRole('PLANNER', { method: 'DELETE', url }));
    assert.equal(cleared.statusCode, 200);
  }
});

test('error handler: known domain error keeps its mapped status unchanged', async () => {
  // no plan exists yet (beforeEach cleared it) -> PLAN_NOT_FOUND, unaffected by the fix
  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/vehicles/PDI-001/cancel-exclusion' }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'PLAN_NOT_FOUND');
});

test('error handler: a legitimate Fastify client error (empty body + Content-Type) now returns a real 4xx, not 500', async () => {
  const res = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/submit',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'FST_ERR_CTP_EMPTY_JSON_BODY');
});

test('error handler: a genuinely unexpected server-side error still sanitizes to 500 without leaking internals', async () => {
  // Force a real, unanticipated failure (not a FastifyError, not a PlanServiceError) by
  // dropping a table a read endpoint depends on, in this disposable DB only. Deliberately
  // the last test in this file -- the whole test DB is dropped in after() right afterward.
  await db.sequelize.query('DROP TABLE vehicles CASCADE');

  const res = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles' }));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  assert.ok(!JSON.stringify(res.json()).toLowerCase().includes('relation'), 'must not leak raw DB error internals');
});
