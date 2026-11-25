'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..');

process.env.NODE_ENV = 'test';

const configPath = require.resolve('./config/config.js');
const baseConfig = require(configPath).test;
// Suffix with our own PID so this run's database name can never collide with
// a pre-existing database (this suite's own default name or anyone else's).
// That guarantees the before()/after() DROP DATABASE calls only ever remove
// a database this run itself created in before(). Set POSTGRES_DB_TEST and
// reload config.js so the migrate subprocess and models/index.js (which both
// read config.js fresh) resolve to this same unique name.
process.env.POSTGRES_DB_TEST = `${baseConfig.database}_${process.pid}`;
delete require.cache[configPath];
const config = require(configPath).test;
const TEST_DB = config.database;

// Guard: refuse to run this suite's setup/teardown against anything but an
// isolated test database. This check runs at module-load time, before the
// before()/after() hooks that issue CREATE/DROP DATABASE exist to be called.
assert.ok(
  baseConfig.database.endsWith('_test') &&
    TEST_DB === `${baseConfig.database}_${process.pid}` &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run db.test.js: resolved test database "${TEST_DB}" does not look like an isolated test database`
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

async function assertRejectsWithPgCode(promise, code, message) {
  await assert.rejects(promise, (err) => {
    const pgCode = err?.parent?.code || err?.original?.code;
    assert.equal(pgCode, code, `expected Postgres error code ${code}, got ${pgCode} (${err.message})`);
    return true;
  }, message);
}

let db;

before(async () => {
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  await admin.end();

  execFileSync('npx', ['sequelize-cli', 'db:migrate'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'ignore',
  });

  // require after migrations exist so models/index.js connects to the fresh test DB
  db = require('./models');
  assert.equal(db.sequelize.config.database, TEST_DB, 'models connected to an unexpected database');
});

after(async () => {
  await db.sequelize.close();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.end();
});

let vehicleCounter = 0;
function makeVehicle(overrides = {}) {
  vehicleCounter += 1;
  return db.Vehicle.create({
    vehicle_id: `PDI-T${vehicleCounter}`,
    demo_vin: `DEMO-T${vehicleCounter}`,
    brand: 'Toyota',
    model: 'TestModel',
    source_location: 'נמל אשדוד',
    population: 'CUSTOMER',
    customer_segment: 'GENERAL',
    envelope_date: '2026-10-01',
    requested_delivery_date: '2026-11-01',
    customs_released: true,
    active_blocker: 'NONE',
    ...overrides,
  });
}

let planDateCounter = 0;
function makePlan(overrides = {}) {
  planDateCounter += 1;
  return db.Plan.create({
    plan_date: `2099-01-${String(planDateCounter).padStart(2, '0')}`,
    status: 'DRAFT',
    capacity_snapshot: 200,
    brand_quotas_snapshot: { Toyota: { quota_target: 55, quota_type: 'HARD' } },
    ...overrides,
  });
}

test('models load and associations resolve', async (t) => {
  assert.ok(db.Vehicle && db.Plan && db.PlanVehicle && db.ManualExclusion && db.AuditEvent && db.BrandQuota && db.ShippingCapacity && db.Setting);

  const vehicle = await makeVehicle();
  const plan = await makePlan();
  const planVehicle = await db.PlanVehicle.create({
    plan_id: plan.id,
    vehicle_id: vehicle.vehicle_id,
    source: 'ALGORITHM',
  });
  t.after(() => db.sequelize.query('DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM vehicles;'));

  const planWithVehicles = await db.Plan.findByPk(plan.id, { include: db.PlanVehicle });
  assert.equal(planWithVehicles.PlanVehicles.length, 1);
  assert.equal(planWithVehicles.PlanVehicles[0].vehicle_id, vehicle.vehicle_id);

  const vehicleWithPlans = await db.Vehicle.findByPk(vehicle.vehicle_id, { include: db.PlanVehicle });
  assert.equal(vehicleWithPlans.PlanVehicles.length, 1);
  assert.equal(vehicleWithPlans.PlanVehicles[0].id, planVehicle.id);
});

test('duplicate plans.plan_date is rejected', async (t) => {
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM plans;'));

  await assertRejectsWithPgCode(
    db.Plan.create({
      plan_date: plan.plan_date,
      status: 'DRAFT',
      capacity_snapshot: 200,
      brand_quotas_snapshot: {},
    }),
    '23505'
  );
});

test('duplicate (plan_id, vehicle_id) in plan_vehicles is rejected', async (t) => {
  const vehicle = await makeVehicle();
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM vehicles;'));

  await db.PlanVehicle.create({ plan_id: plan.id, vehicle_id: vehicle.vehicle_id, source: 'ALGORITHM' });

  await assertRejectsWithPgCode(
    db.PlanVehicle.create({ plan_id: plan.id, vehicle_id: vehicle.vehicle_id, source: 'MANUAL' }),
    '23505'
  );
});

test('two active manual_exclusions for the same (plan_id, vehicle_id) rejected; cancel-then-re-exclude succeeds', async (t) => {
  const vehicle = await makeVehicle();
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM manual_exclusions; DELETE FROM plans; DELETE FROM vehicles;'));

  const first = await db.ManualExclusion.create({
    plan_id: plan.id,
    vehicle_id: vehicle.vehicle_id,
    reason_code: 'OPERATIONAL_DELAY',
    excluded_by_name: 'Test Planner',
    excluded_by_role: 'PLANNER',
  });

  await assertRejectsWithPgCode(
    db.ManualExclusion.create({
      plan_id: plan.id,
      vehicle_id: vehicle.vehicle_id,
      reason_code: 'OTHER',
      note: 'second exclusion attempt',
      excluded_by_name: 'Test Planner',
      excluded_by_role: 'PLANNER',
    }),
    '23505'
  );

  await first.update({ cancelled_at: new Date(), cancelled_by_name: 'Test Planner', cancelled_by_role: 'PLANNER' });

  const second = await db.ManualExclusion.create({
    plan_id: plan.id,
    vehicle_id: vehicle.vehicle_id,
    reason_code: 'PRIORITIZED_OTHER',
    excluded_by_name: 'Test Planner',
    excluded_by_role: 'PLANNER',
  });
  assert.ok(second.id);
});

test('settings.daily_capacity = 0 is rejected', async (t) => {
  t.after(() => db.sequelize.query('DELETE FROM settings;'));
  await assertRejectsWithPgCode(
    db.Setting.create(
      { id: 1, daily_capacity: 0, envelope_yellow_threshold_days: 9, envelope_red_threshold_days: 14 },
      { validate: false }
    ),
    '23514'
  );
});

test('a second settings row (id != 1) is rejected', async (t) => {
  await db.Setting.create({ id: 1, daily_capacity: 200, envelope_yellow_threshold_days: 9, envelope_red_threshold_days: 14 });
  t.after(() => db.sequelize.query('DELETE FROM settings;'));

  await assertRejectsWithPgCode(
    db.Setting.create({ id: 2, daily_capacity: 200, envelope_yellow_threshold_days: 9, envelope_red_threshold_days: 14 }),
    '23514'
  );
});

test('shipping_capacities.capacity < 0 is rejected', async (t) => {
  t.after(() => db.sequelize.query('DELETE FROM shipping_capacities;'));
  await assertRejectsWithPgCode(
    db.ShippingCapacity.create({ source_location: 'נמל אשדוד', capacity: -1 }, { validate: false }),
    '23514'
  );
});

test('brand_quotas.quota_type outside HARD/FLEX is rejected', async (t) => {
  t.after(() => db.sequelize.query('DELETE FROM brand_quotas;'));
  await assertRejectsWithPgCode(
    db.BrandQuota.create({ brand: 'Toyota', quota_target: 55, quota_type: 'BOGUS' }, { validate: false }),
    '23514'
  );
});

test('plan_vehicles FK to a nonexistent vehicle_id is rejected', async (t) => {
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM plan_vehicles; DELETE FROM plans;'));

  await assertRejectsWithPgCode(
    db.PlanVehicle.create({ plan_id: plan.id, vehicle_id: 'PDI-NOPE', source: 'ALGORITHM' }),
    '23503'
  );
});

test('manual_exclusions.note is NOT enforced NOT NULL at the DB level for reason_code=OTHER', async (t) => {
  // SPEC 8.3 requires a mandatory note when reason_code is OTHER. Per Builder's design
  // (confirmed in design review), this is intentionally a service-layer rule, not yet
  // implemented, and not a DB CHECK constraint. This test documents and asserts the
  // current DB-level behavior (insert succeeds with note=NULL); it is not a statement
  // that SPEC 8.3 is satisfied end-to-end -- that depends on application code not yet written.
  const vehicle = await makeVehicle();
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM manual_exclusions; DELETE FROM plans; DELETE FROM vehicles;'));

  const row = await db.ManualExclusion.create({
    plan_id: plan.id,
    vehicle_id: vehicle.vehicle_id,
    reason_code: 'OTHER',
    note: null,
    excluded_by_name: 'Test Planner',
    excluded_by_role: 'PLANNER',
  });
  assert.equal(row.note, null);
});

test('audit_events.payload accepts a representative JSONB payload for every event_type', async (t) => {
  const vehicle = await makeVehicle();
  const plan = await makePlan();
  t.after(() => db.sequelize.query('DELETE FROM audit_events; DELETE FROM plans; DELETE FROM vehicles;'));

  const cases = [
    ['RECOMMENDATION_RUN', { capacity: 200, selected_count: 199 }],
    ['STATUS_TRANSITION', { from: 'DRAFT', to: 'PENDING_SHIPPING' }],
    ['MANUAL_EXCLUSION', { reason_code: 'OPERATIONAL_DELAY', note: null }],
    ['EXCLUSION_CANCELLED', { reason_code: 'OPERATIONAL_DELAY' }],
    ['MANUAL_ADDITION', { vehicle_id: vehicle.vehicle_id }],
    ['BLOCKER_ADDED', { from: 'NONE', to: 'RECALL' }],
    ['BLOCKER_REMOVED', { from: 'RECALL', to: 'NONE' }],
    ['SETTINGS_CHANGED', { field: 'daily_capacity', from: 200, to: 195 }],
    ['SHIPPING_APPROVED', { approved: true }],
    ['SHIPPING_RETURNED', { note: 'חסרה בדיקה' }],
  ];

  for (const [event_type, payload] of cases) {
    const row = await db.AuditEvent.create({
      plan_id: plan.id,
      vehicle_id: vehicle.vehicle_id,
      event_type,
      actor_name: 'Test Actor',
      actor_role: 'PLANNER',
      payload,
    });
    assert.deepEqual(row.payload, payload);
  }
});
