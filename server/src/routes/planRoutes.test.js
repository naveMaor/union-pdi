'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_api_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

// Ownership check: refuse to touch anything but an isolated, disposable API-test
// database, before any CREATE/DROP DATABASE statement is ever issued.
assert.ok(
  TEST_DB &&
    TEST_DB.includes('api') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run planRoutes.test.js: resolved test database "${TEST_DB}" does not look like an isolated api-test database`
);

function adminClient(database = 'postgres') {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database,
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
let app;

before(async () => {
  // try/finally around setup: if anything after CREATE DATABASE throws (e.g. the
  // migration step), still drop the just-created database rather than leaking it.
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
  app = buildApp();
});

async function inject(opts) {
  return app.inject(opts);
}

function withRole(role, opts = {}) {
  return { ...opts, headers: { ...(opts.headers || {}), 'x-demo-role': role } };
}

async function generateBaseline() {
  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(res.statusCode, 200);
  return res.json();
}

test('missing/invalid x-demo-role header is rejected with 400, not a raw 500', async () => {
  const noHeader = await inject({ method: 'GET', url: '/api/plan' });
  assert.equal(noHeader.statusCode, 400);
  assert.equal(noHeader.json().error, 'INVALID_DEMO_ROLE');

  const badHeader = await inject(withRole('SUPERUSER', { method: 'GET', url: '/api/plan' }));
  assert.equal(badHeader.statusCode, 400);
});

test('generate: SHIPPING role rejected with 403, PLANNER succeeds with DRAFT/200 (SPEC 14 test 3)', async () => {
  const forbidden = await inject(withRole('SHIPPING', { method: 'POST', url: '/api/plan/generate' }));
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, 'FORBIDDEN_ROLE');

  const result = await generateBaseline();
  assert.equal(result.plan.status, 'DRAFT');
  assert.equal(result.selected.length, 200);
  const util = Object.fromEntries(Object.entries(result.brandQuotaUtilization).map(([b, u]) => [b, u.selected]));
  assert.deepEqual(util, { Toyota: 55, Lexus: 36, Geely: 44, GAC: 22, Zeekr: 43 });
});

function assertConfirmationRequired(response, status) {
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: 'CONFIRMATION_REQUIRED',
    message: 'A plan already exists for this date. Resend with { "confirm": true } to regenerate it.',
    plan: { status },
  });
}

test('concurrent bodyless generation requests persist one plan and one recommendation run', async () => {
  const gate = adminClient(TEST_DB);
  await gate.connect();
  const lockKey = 'plan:2026-11-23';
  let requests;
  try {
    await gate.query('BEGIN');
    await gate.query('SELECT pg_advisory_xact_lock(hashtext($1), 0)', [lockKey]);
    const generate = () => inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
    requests = Promise.all([generate(), generate()]);

    // Release the gate only when both requests are waiting on the actual plan lock.
    const deadline = performance.now() + 5000;
    let waiting;
    do {
      const result = await gate.query(
        `SELECT count(*)::int AS waiting FROM pg_locks
         WHERE locktype = 'advisory' AND NOT granted
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND classid = hashtext($1)::oid AND objid = 0 AND objsubid = 2`,
        [lockKey]
      );
      waiting = result.rows[0].waiting;
    } while (waiting < 2 && performance.now() < deadline);
    assert.equal(waiting, 2);
  } finally {
    await gate.end();
    await requests;
  }

  const responses = await requests;
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
  const accepted = responses.find((response) => response.statusCode === 200).json();
  assertConfirmationRequired(responses.find((response) => response.statusCode === 409), 'DRAFT');
  const plans = await db.Plan.findAll();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, accepted.plan.id);
  assert.equal(plans[0].status, 'DRAFT');
  assert.equal(plans[0].last_recommendation_run_at.toISOString(), accepted.plan.last_recommendation_run_at);
  const members = await db.PlanVehicle.findAll({ order: [['vehicle_id', 'ASC']] });
  assert.deepEqual(members.map((member) => member.vehicle_id), accepted.selected.map((row) => row.vehicle_id).sort());
  assert.equal(members.length, 200);
  assert.ok(members.every((member) => member.plan_id === accepted.plan.id && member.source === 'ALGORITHM'));
  const events = await db.AuditEvent.findAll({ order: [['id', 'ASC']] });
  assert.deepEqual(events.map((event) => event.event_type), ['STATUS_TRANSITION', 'RECOMMENDATION_RUN']);
  assert.ok(events.every((event) => event.plan_id === accepted.plan.id));
});

test('existing DRAFT requires boolean confirmation before regeneration', async () => {
  const baseline = await generateBaseline();

  for (const payload of [undefined, { confirm: false }, { confirm: 'true' }]) {
    const response = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload }));
    assertConfirmationRequired(response, 'DRAFT');
  }
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'RECOMMENDATION_RUN' } }), 1);
  assert.equal((await db.Plan.findByPk(baseline.plan.id)).last_recommendation_run_at.toISOString(),
    baseline.plan.last_recommendation_run_at);

  const withConfirm = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } })
  );
  assert.equal(withConfirm.statusCode, 200);
  assert.equal(withConfirm.json().plan.id, baseline.plan.id);
  assert.equal(withConfirm.json().selected.length, 200);
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'RECOMMENDATION_RUN' } }), 2);
});

test('existing RETURNED requires confirmation and retains its status and note after regeneration', async () => {
  const baseline = await generateBaseline();
  const submit = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submit.statusCode, 200);
  const comment = 'בדיקת הרצה של תכנית מוחזרת';
  const returned = await inject(withRole('SHIPPING', {
    method: 'POST', url: '/api/plan/return', payload: { comment },
  }));
  assert.equal(returned.statusCode, 200);

  const unconfirmed = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate' }));
  assertConfirmationRequired(unconfirmed, 'RETURNED');
  const confirmed = await inject(withRole('PLANNER', {
    method: 'POST', url: '/api/plan/generate', payload: { confirm: true },
  }));
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().plan.id, baseline.plan.id);
  assert.equal(confirmed.json().plan.status, 'RETURNED');
  assert.equal(confirmed.json().plan.returned_note, comment);
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'RECOMMENDATION_RUN' } }), 2);
});

test('locked plans cannot regenerate with or without confirmation', async () => {
  const baseline = await generateBaseline();

  for (const [step, role, status] of [
    ['submit', 'PLANNER', 'PENDING_SHIPPING'],
    ['approve', 'SHIPPING', 'APPROVED'],
  ]) {
    const transition = await inject(withRole(role, { method: 'POST', url: `/api/plan/${step}` }));
    assert.equal(transition.statusCode, 200);
    for (const payload of [undefined, { confirm: true }]) {
      const response = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload }));
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, 'PLAN_LOCKED');
    }
    const plan = await db.Plan.findByPk(baseline.plan.id);
    assert.equal(plan.status, status);
    assert.equal(plan.last_recommendation_run_at.toISOString(), baseline.plan.last_recommendation_run_at);
    assert.equal(await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } }), 200);
    assert.equal(await db.AuditEvent.count({ where: { event_type: 'RECOMMENDATION_RUN' } }), 1);
  }
});

test('GET /api/plan summary reflects the generated plan correctly', async () => {
  await generateBaseline();

  const res = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan' }));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.plan.status, 'DRAFT');
  assert.equal(body.capacity.selected, 200);
  assert.equal(body.capacity.target, 200);
  assert.deepEqual(body.sourceLocationCounts, {
    'נמל חיפה': 52,
    'נמל אשדוד': 51,
    'בונדד אשדוד': 49,
    'בונדד חיפה': 48,
  });
  assert.deepEqual(body.blockerWarnings, []);
});

test('GET /api/vehicles tabs: all=300, in_plan=200, ineligible=38 (SPEC 14 test 2)', async () => {
  await generateBaseline();

  const all = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=all' }));
  assert.equal(all.json().count, 300);

  const inPlan = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=in_plan' }));
  assert.equal(inPlan.json().count, 200);

  const ineligible = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=ineligible' }));
  assert.equal(ineligible.json().count, 38);

  const search = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?search=PDI-195' }));
  assert.ok(search.json().vehicles.some((v) => v.vehicle_id === 'PDI-195'));
});

test('SPEC section 14 test 6 via HTTP: exclude PDI-195 suggests PDI-200; confirming restores 200', async () => {
  await generateBaseline();

  const excludeRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-195/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );
  assert.equal(excludeRes.statusCode, 200);
  assert.equal(excludeRes.json().suggestedReplacement.vehicle_id, 'PDI-200');

  const confirmRes = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/replacement/confirm', payload: { vehicleId: 'PDI-200' } })
  );
  assert.equal(confirmRes.statusCode, 200);

  const inPlan = await inject(withRole('PLANNER', { method: 'GET', url: '/api/vehicles?tab=in_plan' }));
  assert.equal(inPlan.json().count, 200);
});

test('SPEC section 14 test 7 via HTTP: exclude PDI-281 suggests PDI-107', async () => {
  await generateBaseline();

  const excludeRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-281/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );
  assert.equal(excludeRes.statusCode, 200);
  assert.equal(excludeRes.json().suggestedReplacement.vehicle_id, 'PDI-107');
});

test('SPEC section 14 test 8 via HTTP: regenerate preserves exclusion; cancel+regenerate restores the vehicle', async () => {
  await generateBaseline();

  await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-195/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );

  const regen1 = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } })
  );
  assert.equal(regen1.json().selected.length, 200);
  assert.ok(!regen1.json().selected.some((v) => v.vehicle_id === 'PDI-195'));

  await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/vehicles/PDI-195/cancel-exclusion' }));

  const regen2 = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/plan/generate', payload: { confirm: true } })
  );
  assert.ok(regen2.json().selected.some((v) => v.vehicle_id === 'PDI-195'));
});

test('SPEC section 14 test 10 via HTTP: once PENDING_SHIPPING, excluding a vehicle is rejected server-side', async () => {
  const baseline = await generateBaseline();
  await db.Plan.update({ status: 'PENDING_SHIPPING' }, { where: { id: baseline.plan.id } });

  const res = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/vehicles/PDI-001/exclude',
      payload: { reasonCode: 'OPERATIONAL_DELAY' },
    })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'PLAN_LOCKED');

  const planVehicleCount = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });
  assert.equal(planVehicleCount, 200, 'plan_vehicles must be unchanged');
});

test('locking is consistent across cancel-exclusion, confirm-replacement, and submit once PENDING_SHIPPING/APPROVED', async () => {
  const baseline = await generateBaseline();

  for (const lockedStatus of ['PENDING_SHIPPING', 'APPROVED']) {
    await db.Plan.update({ status: lockedStatus }, { where: { id: baseline.plan.id } });

    const cancelRes = await inject(
      withRole('PLANNER', { method: 'POST', url: '/api/plan/vehicles/PDI-001/cancel-exclusion' })
    );
    assert.equal(cancelRes.statusCode, 409);

    const confirmRes = await inject(
      withRole('PLANNER', { method: 'POST', url: '/api/plan/replacement/confirm', payload: { vehicleId: 'PDI-001' } })
    );
    assert.equal(confirmRes.statusCode, 409);

    const submitRes = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
    assert.equal(submitRes.statusCode, 409);
  }
});

test('SPEC section 14 test 11: blocker on an in-plan vehicle warns and blocks submission without removing it', async () => {
  const baseline = await generateBaseline();
  const inPlanVehicleId = 'PDI-001';
  assert.ok((await db.PlanVehicle.findOne({ where: { plan_id: baseline.plan.id, vehicle_id: inPlanVehicleId } })) !== null);

  const blockerRes = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: `/api/vehicles/${inPlanVehicleId}/blocker`,
      payload: { blockerCode: 'RECALL' },
    })
  );
  assert.equal(blockerRes.statusCode, 200);

  const stillInPlan = await db.PlanVehicle.findOne({ where: { plan_id: baseline.plan.id, vehicle_id: inPlanVehicleId } });
  assert.ok(stillInPlan, 'a blocker must not remove the vehicle from the plan automatically');

  const summary = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan' }));
  assert.ok(summary.json().blockerWarnings.some((w) => w.vehicle_id === inPlanVehicleId && w.active_blocker === 'RECALL'));

  const submitBlocked = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submitBlocked.statusCode, 409);
  assert.equal(submitBlocked.json().error, 'INELIGIBLE_VEHICLES_IN_PLAN');

  const removeRes = await inject(
    withRole('PLANNER', { method: 'DELETE', url: `/api/vehicles/${inPlanVehicleId}/blocker` })
  );
  assert.equal(removeRes.statusCode, 200);

  const submitOk = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submitOk.statusCode, 200);
  assert.equal(submitOk.json().plan.status, 'PENDING_SHIPPING');
});

test('blocker add/remove is allowed even on a PENDING_SHIPPING plan (SPEC 9 last line: warning-only, not blocked)', async (t) => {
  const baseline = await generateBaseline();
  await db.Plan.update({ status: 'PENDING_SHIPPING' }, { where: { id: baseline.plan.id } });
  t.after(() => db.Vehicle.update({ active_blocker: 'NONE' }, { where: { vehicle_id: 'PDI-001' } }));

  const addRes = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/vehicles/PDI-001/blocker', payload: { blockerCode: 'RECALL' } })
  );
  assert.equal(addRes.statusCode, 200, 'blocker operations themselves must not be status-gated');

  const summary = await inject(withRole('PLANNER', { method: 'GET', url: '/api/plan' }));
  assert.ok(summary.json().blockerWarnings.some((w) => w.vehicle_id === 'PDI-001'));
});

test('invalid blocker code rejected with 400', async () => {
  await generateBaseline();
  const res = await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/vehicles/PDI-001/blocker', payload: { blockerCode: 'NOT_REAL' } })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'INVALID_BLOCKER_CODE');
});

test('empty-plan submission rejected (409 EMPTY_PLAN)', async () => {
  const baseline = await generateBaseline();
  await db.PlanVehicle.destroy({ where: { plan_id: baseline.plan.id } });

  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'EMPTY_PLAN');
});

test('ineligible-member submission rejected even when eligibility was changed directly in the DB, not via the blocker endpoint', async (t) => {
  const baseline = await generateBaseline();
  await db.Vehicle.update({ customs_released: false }, { where: { vehicle_id: 'PDI-001' } });
  t.after(() => db.Vehicle.update({ customs_released: true }, { where: { vehicle_id: 'PDI-001' } }));

  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'INELIGIBLE_VEHICLES_IN_PLAN');

  const planVehicleCount = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });
  assert.equal(planVehicleCount, 200, 'rejected submission must not remove the vehicle either');
});

test('shipping_capacities values have zero bearing on submission success', async () => {
  await generateBaseline();
  await db.ShippingCapacity.update({ capacity: 0 }, { where: {} });

  const res = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().plan.status, 'PENDING_SHIPPING');
});

test('server never trusts a client-supplied actor name for the audit trail', async () => {
  const result = await inject(
    withRole('PLANNER', {
      method: 'POST',
      url: '/api/plan/generate',
      payload: { actorName: 'Someone Else Entirely' }, // not a real field on this route; must be ignored
    })
  );
  assert.equal(result.statusCode, 200);

  const event = await db.AuditEvent.findOne({ where: { event_type: 'STATUS_TRANSITION' } });
  assert.equal(event.actor_name, 'מיכל לוי');
  assert.notEqual(event.actor_name, 'Someone Else Entirely');
});

test('audit events for blocker add/remove and submission carry correct actor/payload', async () => {
  const baseline = await generateBaseline();

  await inject(
    withRole('PLANNER', { method: 'POST', url: '/api/vehicles/PDI-050/blocker', payload: { blockerCode: 'DAMAGE' } })
  );
  const addedEvent = await db.AuditEvent.findOne({ where: { event_type: 'BLOCKER_ADDED', vehicle_id: 'PDI-050' } });
  assert.equal(addedEvent.actor_name, 'מיכל לוי');
  assert.deepEqual(addedEvent.payload, { previous_blocker: 'NONE', new_blocker: 'DAMAGE' });

  await inject(withRole('PLANNER', { method: 'DELETE', url: '/api/vehicles/PDI-050/blocker' }));
  const removedEvent = await db.AuditEvent.findOne({ where: { event_type: 'BLOCKER_REMOVED', vehicle_id: 'PDI-050' } });
  assert.deepEqual(removedEvent.payload, { previous_blocker: 'DAMAGE', new_blocker: 'NONE' });

  const submitRes = await inject(withRole('PLANNER', { method: 'POST', url: '/api/plan/submit' }));
  assert.equal(submitRes.statusCode, 200);
  const transitionEvent = await db.AuditEvent.findOne({
    where: { event_type: 'STATUS_TRANSITION', plan_id: baseline.plan.id },
    order: [['id', 'DESC']],
  });
  assert.deepEqual(transitionEvent.payload, { from: 'DRAFT', to: 'PENDING_SHIPPING' });
});
