'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..');

process.env.NODE_ENV = 'test';
// Distinct name from db.test.js's own test DB, so the two suites never collide
// if the test runner executes both files concurrently.
process.env.POSTGRES_DB_TEST = `union_pdi_test_seed_${process.pid}`;

const config = require('./config/config.js').test;
const TEST_DB = config.database;

// Guard: refuse to run this suite's setup/teardown against anything but an
// isolated, disposable seed-test database. Runs before before()/after() exist
// to issue any CREATE/DROP DATABASE statement.
assert.ok(
  TEST_DB &&
    TEST_DB.includes('seed') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run seed.test.js: resolved test database "${TEST_DB}" does not look like an isolated seed-test database`
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

let db;
let seed;

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

  db = require('./models');
  assert.equal(db.sequelize.config.database, TEST_DB, 'models connected to an unexpected database');

  seed = require('./scripts/seed');
});

after(async () => {
  await db.sequelize.close();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.end();
});

test('seed produces exactly 300 vehicles with correct defaults and field values', async () => {
  await seed.run();

  const vehicleCount = await db.Vehicle.count();
  assert.equal(vehicleCount, 300);

  const settings = await db.Setting.findByPk(1);
  assert.equal(settings.daily_capacity, 200);
  assert.equal(settings.envelope_yellow_threshold_days, 9);
  assert.equal(settings.envelope_red_threshold_days, 14);

  const quotas = await db.BrandQuota.findAll({ order: [['brand', 'ASC']] });
  const quotaByBrand = Object.fromEntries(quotas.map((q) => [q.brand, { target: q.quota_target, type: q.quota_type }]));
  assert.deepEqual(quotaByBrand, {
    GAC: { target: 22, type: 'HARD' },
    Geely: { target: 32, type: 'FLEX' },
    Lexus: { target: 36, type: 'HARD' },
    Toyota: { target: 55, type: 'HARD' },
    Zeekr: { target: 28, type: 'FLEX' },
  });

  const capacities = await db.ShippingCapacity.findAll();
  const capacityByLocation = Object.fromEntries(capacities.map((c) => [c.source_location, c.capacity]));
  assert.deepEqual(capacityByLocation, {
    'נמל אשדוד': 65,
    'נמל חיפה': 65,
    'בונדד אשדוד': 65,
    'בונדד חיפה': 65,
  });

  // Field values cross-checked directly against docs/assignment/pdi_seed_300_vehicles.csv
  const first = await db.Vehicle.findByPk('PDI-001');
  assert.equal(first.demo_vin, 'DEMO-000001');
  assert.equal(first.brand, 'Toyota');
  assert.equal(first.model, 'RAV4');
  assert.equal(first.source_location, 'נמל אשדוד');
  assert.equal(first.population, 'CUSTOMER');
  assert.equal(first.customer_segment, 'GENERAL');
  assert.equal(first.envelope_date, '2026-10-28');
  assert.equal(first.requested_delivery_date, '2026-11-28');
  assert.equal(first.customs_released, true);
  assert.equal(first.active_blocker, 'NONE');

  // SPEC 9's own SECURITY_FORCES examples
  const securityForces = await db.Vehicle.findAll({ where: { customer_segment: 'SECURITY_FORCES' } });
  assert.deepEqual(
    securityForces.map((v) => v.vehicle_id).sort(),
    ['PDI-220', 'PDI-260', 'PDI-270']
  );
});

test('SPEC section 14 test 2 eligibility counts: 262 eligible, 38 ineligible (9 customs + 29 blocker, no overlap)', async () => {
  const total = await db.Vehicle.count();
  assert.equal(total, 300);

  const eligible = await db.Vehicle.count({ where: { customs_released: true, active_blocker: 'NONE' } });
  assert.equal(eligible, 262);

  const notCustomsReleased = await db.Vehicle.count({ where: { customs_released: false } });
  assert.equal(notCustomsReleased, 9);

  const blocked = await db.Vehicle.count({ where: { active_blocker: { [db.Sequelize.Op.ne]: 'NONE' } } });
  assert.equal(blocked, 29);

  const overlap = await db.Vehicle.count({
    where: { customs_released: false, active_blocker: { [db.Sequelize.Op.ne]: 'NONE' } },
  });
  assert.equal(overlap, 0, 'expected the not-customs-released set and the blocked set to be disjoint');

  assert.equal(total - eligible, 38);
});

test('seed is idempotent: rerunning does not duplicate vehicles', async () => {
  await seed.run();
  const countAfterSecondRun = await db.Vehicle.count();
  assert.equal(countAfterSecondRun, 300);

  const distinctIds = await db.Vehicle.count({ distinct: true, col: 'vehicle_id' });
  assert.equal(distinctIds, 300);
});

test('seed does not overwrite config values or vehicle fields already changed from defaults', async (t) => {
  await db.Setting.update({ daily_capacity: 195 }, { where: { id: 1 } });
  await db.BrandQuota.update({ quota_target: 999 }, { where: { brand: 'Geely' } });
  await db.ShippingCapacity.update({ capacity: 1 }, { where: { source_location: 'נמל חיפה' } });
  await db.Vehicle.update({ active_blocker: 'RECALL' }, { where: { vehicle_id: 'PDI-001' } });

  t.after(async () => {
    // restore defaults so later tests in this file aren't affected
    await db.Setting.update({ daily_capacity: 200 }, { where: { id: 1 } });
    await db.BrandQuota.update({ quota_target: 32 }, { where: { brand: 'Geely' } });
    await db.ShippingCapacity.update({ capacity: 65 }, { where: { source_location: 'נמל חיפה' } });
    await db.Vehicle.update({ active_blocker: 'NONE' }, { where: { vehicle_id: 'PDI-001' } });
  });

  await seed.run();

  const settings = await db.Setting.findByPk(1);
  assert.equal(settings.daily_capacity, 195, 'seed must not reset an admin-changed setting');

  const geely = await db.BrandQuota.findByPk('Geely');
  assert.equal(geely.quota_target, 999, 'seed must not reset an admin-changed brand quota');

  const haifaPort = await db.ShippingCapacity.findByPk('נמל חיפה');
  assert.equal(haifaPort.capacity, 1, 'seed must not reset an admin-changed shipping capacity');

  const pdi001 = await db.Vehicle.findByPk('PDI-001');
  assert.equal(pdi001.active_blocker, 'RECALL', 'seed must not clear a planner-added blocker on reseed');

  const vehicleCount = await db.Vehicle.count();
  assert.equal(vehicleCount, 300);
});
