'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_replget_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('replget') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run planReplacementGet.test.js: resolved test database "${TEST_DB}" does not look like an isolated replget-test database`
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

function withRole(role, opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), 'x-demo-role': role } };
}

async function inject(opts) {
  return app.inject(opts);
}

async function generateDraft() {
  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(res.statusCode, 200);
  return res.json();
}

test('GET /api/plan/replacement recovers the same suggestion exclude returned, without mutating anything', async () => {
  await generateDraft();

  const excludeRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-195/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );
  assert.equal(excludeRes.statusCode, 200);
  const originalSuggestion = excludeRes.json().suggestedReplacement;
  assert.equal(originalSuggestion.vehicle_id, 'PDI-200');

  const beforeCount = await db.PlanVehicle.count();
  const beforeAudit = await db.AuditEvent.count();

  // Simulate a browser refresh: a fresh GET should return the identical suggestion.
  const getRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.json(), { suggestedReplacement: originalSuggestion });

  // Read-only: no plan_vehicles row added/removed, no new audit event.
  assert.equal(await db.PlanVehicle.count(), beforeCount);
  assert.equal(await db.AuditEvent.count(), beforeAudit);

  // Confirmation still works off the recovered suggestion afterward.
  const confirmRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/replacement/confirm',
      payload: { vehicleId: originalSuggestion.vehicle_id },
    })
  );
  assert.equal(confirmRes.statusCode, 200);
});

test('GET /api/plan/replacement reflects changed eligibility since the original suggestion', async (t) => {
  t.after(async () => {
    await db.Vehicle.update({ active_blocker: 'NONE' }, { where: { vehicle_id: 'PDI-200' } });
  });
  await generateDraft();

  const excludeRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-195/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );
  assert.equal(excludeRes.json().suggestedReplacement.vehicle_id, 'PDI-200');

  // Block the previously suggested vehicle so it's no longer eligible.
  const blockerRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/vehicles/PDI-200/blocker',
      payload: { blockerCode: 'DAMAGE' },
    })
  );
  assert.equal(blockerRes.statusCode, 200);

  const getRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(getRes.statusCode, 200);
  const refreshed = getRes.json().suggestedReplacement;
  assert.ok(refreshed);
  assert.notEqual(refreshed.vehicle_id, 'PDI-200');

  // Confirming the stale (now-ineligible) suggestion must still be rejected server-side.
  const staleConfirm = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/replacement/confirm', payload: { vehicleId: 'PDI-200' } })
  );
  assert.equal(staleConfirm.statusCode, 409);
  assert.equal(staleConfirm.json().error, 'STALE_SUGGESTION');
});

test('GET /api/plan/replacement returns suggestedReplacement: null when plan membership already reached capacity_snapshot (SPEC 8.4 "room in capacity")', async () => {
  // The baseline plan already reaches its capacity_snapshot (200/200) on the
  // very first generation, with nothing excluded. SPEC section 8.4 requires
  // "room in capacity" as one of the server-side conditions for adding a
  // replacement — a vehicle must never be suggested when there's no room.
  const gen = await generateDraft();
  assert.equal(gen.selected.length, 200);
  assert.equal(gen.plan.capacity_snapshot, 200);

  const getRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.json(), { suggestedReplacement: null });
});

test('GET /api/plan/replacement returns suggestedReplacement: null when every eligible candidate is already in the plan', async (t) => {
  t.after(async () => {
    await inject(withRole('ADMIN', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 200 } }));
  });

  // computeSuggestedReplacement() only checks eligibility/exclusion/HARD-quota —
  // it does not factor in overall plan capacity (by design, inherited unchanged
  // from Task 3). So a plan merely "at capacity" still has a next-FIFO FLEX
  // candidate outside it. To genuinely exhaust every eligible vehicle (so there
  // really is nothing left to suggest), raise capacity so the plan admits all
  // 262 SPEC section 14 test 2 eligible vehicles.
  const setCapacity = await inject(
    withRole('ADMIN', { method: 'PUT', url: '/api/settings', payload: { dailyCapacity: 262 } })
  );
  assert.equal(setCapacity.statusCode, 200);

  const gen = await generateDraft();
  // HARD-quota brands (Toyota/Lexus/GAC) still cap at their targets even with
  // capacity raised to 262; only the FLEX brands (Geely/Zeekr) absorb the rest,
  // which exhausts every remaining eligible FLEX candidate before 262 is
  // reached. What matters for this test is that every vehicle outside the plan
  // is now ineligible, excluded, or in a HARD brand already at its quota.
  assert.ok(gen.selected.length < 262);

  const getRes = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.json(), { suggestedReplacement: null });
});

test('GET /api/plan/replacement rejects non-PLANNER roles', async () => {
  await generateDraft();
  for (const role of ['SHIPPING', 'ADMIN']) {
    const res = await inject(withRole(role, { method: 'GET', url: '/api/plan/replacement' }));
    assert.equal(res.statusCode, 403, `expected 403 for role ${role}`);
  }
});

test('GET /api/plan/replacement rejects when no plan exists yet', async () => {
  const res = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'PLAN_NOT_FOUND');
});

test('GET /api/plan/replacement rejects when the plan is locked (PENDING_SHIPPING)', async () => {
  await generateDraft();
  const submitRes = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submitRes.statusCode, 200);

  const res = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan/replacement' }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'PLAN_LOCKED');
});

test('POST /api/plan/replacement/confirm rejects an addition beyond capacity_snapshot server-side (SPEC 8.4 "room in capacity")', async () => {
  // Baseline plan is already at capacity_snapshot (200/200) with nothing
  // excluded, so there is no room and no vehicle_id can be a valid confirmation
  // target — confirming any arbitrary vehicle_id must be rejected as stale,
  // never inserted regardless of what the client claims was "suggested".
  await generateDraft();

  const confirmRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/replacement/confirm',
      payload: { vehicleId: 'PDI-200' },
    })
  );
  assert.equal(confirmRes.statusCode, 409);
  assert.equal(confirmRes.json().error, 'STALE_SUGGESTION');

  const stillOut = await db.PlanVehicle.findOne({ where: { vehicle_id: 'PDI-200' } });
  assert.equal(stillOut, null, 'PDI-200 must not have been inserted into plan_vehicles');
});
