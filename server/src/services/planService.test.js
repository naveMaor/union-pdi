'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_plan_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('plan') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run planService.test.js: resolved test database "${TEST_DB}" does not look like an isolated plan-test database`
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
let planService;
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

  db = require('../models');
  assert.equal(db.sequelize.config.database, TEST_DB, 'models connected to an unexpected database');

  seed = require('../scripts/seed');
  planService = require('./planService');

  await seed.run(); // full real CSV + SPEC default settings/quotas/shipping capacities
});

after(async () => {
  await db.sequelize.close();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.end();
});

beforeEach(async () => {
  // fresh plan slate before every test; vehicles/settings/brand_quotas/shipping_capacities
  // are restored by whichever test changed them, via t.after
  await db.sequelize.query(
    'DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM audit_events;'
  );
});

test('first generation: SPEC section 14 test 3 reproduces end-to-end through the real service + DB', async () => {
  const result = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });

  assert.equal(result.plan.status, 'DRAFT');
  assert.equal(result.plan.plan_date, planService.PLAN_DATE);
  assert.equal(result.plan.capacity_snapshot, 200);
  assert.equal(result.selected.length, 200);

  const util = Object.fromEntries(Object.entries(result.brandQuotaUtilization).map(([b, u]) => [b, u.selected]));
  assert.deepEqual(util, { Toyota: 55, Lexus: 36, Geely: 44, GAC: 22, Zeekr: 43 });
  assert.equal(result.brandQuotaUtilization.Geely.overage, 12);
  assert.equal(result.brandQuotaUtilization.Zeekr.overage, 15);

  assert.deepEqual(result.sourceLocationCounts, {
    'נמל חיפה': 52,
    'נמל אשדוד': 51,
    'בונדד אשדוד': 49,
    'בונדד חיפה': 48,
  });

  const planVehicleCount = await db.PlanVehicle.count({ where: { plan_id: result.plan.id } });
  assert.equal(planVehicleCount, 200);
  const manualRows = await db.PlanVehicle.count({ where: { plan_id: result.plan.id, source: 'MANUAL' } });
  assert.equal(manualRows, 0);

  const events = await db.AuditEvent.findAll({ where: { plan_id: result.plan.id }, order: [['id', 'ASC']] });
  assert.equal(events.length, 2);
  assert.equal(events[0].event_type, 'STATUS_TRANSITION');
  assert.deepEqual(events[0].payload, { from: null, to: 'DRAFT' });
  assert.equal(events[1].event_type, 'RECOMMENDATION_RUN');

  const planRow = await db.Plan.findByPk(result.plan.id);
  assert.deepEqual(planRow.brand_quotas_snapshot.Toyota, { quota_target: 55, quota_type: 'HARD' });
  assert.deepEqual(planRow.brand_quotas_snapshot.Geely, { quota_target: 32, quota_type: 'FLEX' });
});

test('capacity 195: SPEC section 14 test 5 reproduces end-to-end', async (t) => {
  await db.Setting.update({ daily_capacity: 195 }, { where: { id: 1 } });
  t.after(() => db.Setting.update({ daily_capacity: 200 }, { where: { id: 1 } }));

  const result = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });

  assert.equal(result.selected.length, 195);
  const util = Object.fromEntries(Object.entries(result.brandQuotaUtilization).map(([b, u]) => [b, u.selected]));
  assert.deepEqual(util, { Toyota: 55, Lexus: 36, Geely: 42, GAC: 20, Zeekr: 42 });
});

test('regeneration preserves a manual exclusion and clears a prior manual addition', async () => {
  const first = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });
  const excludedId = first.selected[0].vehicle_id;

  await db.ManualExclusion.create({
    plan_id: first.plan.id,
    vehicle_id: excludedId,
    reason_code: 'OPERATIONAL_DELAY',
    excluded_by_name: 'Michal Levi',
    excluded_by_role: 'PLANNER',
  });

  // simulate a prior manual addition that must be cleared on regen
  const notSelectedEligible = (await db.Vehicle.findAll({ where: { customs_released: true, active_blocker: 'NONE' }, raw: true }))
    .find((v) => !first.selected.some((s) => s.vehicle_id === v.vehicle_id) && v.vehicle_id !== excludedId);
  await db.PlanVehicle.create({ plan_id: first.plan.id, vehicle_id: notSelectedEligible.vehicle_id, source: 'MANUAL' });

  const second = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER', confirm: true });

  assert.ok(!second.selected.some((v) => v.vehicle_id === excludedId), 'excluded vehicle must never reappear');
  const manualRowsAfterRegen = await db.PlanVehicle.count({ where: { plan_id: second.plan.id, source: 'MANUAL' } });
  assert.equal(manualRowsAfterRegen, 0, 'manual additions must be cleared on regeneration');

  const planCount = await db.Plan.count();
  assert.equal(planCount, 1, 'regeneration must not create a second Plan row');

  const events = await db.AuditEvent.findAll({ where: { plan_id: second.plan.id } });
  assert.equal(events.length, 3, '1 STATUS_TRANSITION (first gen) + 2 RECOMMENDATION_RUN (both runs), no extra STATUS_TRANSITION on regen');
  assert.equal(events.filter((e) => e.event_type === 'STATUS_TRANSITION').length, 1);
  assert.equal(events.filter((e) => e.event_type === 'RECOMMENDATION_RUN').length, 2);
});

test('snapshot is not retroactively changed by a later parameter edit, but reflects current params on the next run', async (t) => {
  const first = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });
  assert.equal(first.plan.capacity_snapshot, 200);
  assert.equal(first.plan.brand_quotas_snapshot.Geely.quota_target, 32);

  await db.Setting.update({ daily_capacity: 150 }, { where: { id: 1 } });
  await db.BrandQuota.update({ quota_target: 999 }, { where: { brand: 'Geely' } });
  t.after(async () => {
    await db.Setting.update({ daily_capacity: 200 }, { where: { id: 1 } });
    await db.BrandQuota.update({ quota_target: 32 }, { where: { brand: 'Geely' } });
  });

  const unchangedPlan = await db.Plan.findByPk(first.plan.id);
  assert.equal(unchangedPlan.capacity_snapshot, 200, 'parameter change must not retroactively alter an existing plan snapshot');
  assert.equal(unchangedPlan.brand_quotas_snapshot.Geely.quota_target, 32);

  const regenerated = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER', confirm: true });
  assert.equal(regenerated.plan.capacity_snapshot, 150, 'a new run must use current parameters');
  assert.equal(regenerated.plan.brand_quotas_snapshot.Geely.quota_target, 999);
});

test('regeneration is rejected when the plan is PENDING_SHIPPING or APPROVED', async () => {
  const first = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });

  for (const lockedStatus of ['PENDING_SHIPPING', 'APPROVED']) {
    await db.Plan.update({ status: lockedStatus }, { where: { id: first.plan.id } });

    await assert.rejects(
      planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' }),
      (err) => {
        assert.ok(err instanceof planService.PlanServiceError);
        assert.equal(err.code, 'PLAN_LOCKED');
        return true;
      }
    );

    const planVehicleCount = await db.PlanVehicle.count({ where: { plan_id: first.plan.id } });
    assert.equal(planVehicleCount, 200, `plan_vehicles must be unchanged while status is ${lockedStatus}`);
  }
});

test('generation/regeneration is rejected for a non-PLANNER role, with no state change', async () => {
  for (const role of ['SHIPPING', 'ADMIN']) {
    await assert.rejects(
      planService.generatePlan({ actorName: 'Yossi Cohen', actorRole: role }),
      (err) => {
        assert.ok(err instanceof planService.PlanServiceError);
        assert.equal(err.code, 'FORBIDDEN_ROLE');
        return true;
      }
    );
  }

  const planCount = await db.Plan.count();
  assert.equal(planCount, 0, 'no plan should have been created by a rejected role');
});

test('shipping_capacities values have zero effect on the generated selection', async (t) => {
  const baseline = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });

  await db.ShippingCapacity.update({ capacity: 1 }, { where: {} });
  t.after(() => db.ShippingCapacity.update({ capacity: 65 }, { where: {} }));

  const regenerated = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER', confirm: true });

  assert.deepEqual(
    regenerated.selected.map((v) => v.vehicle_id).sort(),
    baseline.selected.map((v) => v.vehicle_id).sort()
  );
  assert.deepEqual(regenerated.sourceLocationCounts, baseline.sourceLocationCounts);
});

test('two concurrent unconfirmed service calls persist exactly one recommendation (advisory lock)', async () => {
  const results = await Promise.allSettled([
    planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' }),
    planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' }),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'CONFIRMATION_REQUIRED');
  assert.equal(await db.Plan.count(), 1);
  assert.equal(await db.AuditEvent.count({ where: { event_type: 'RECOMMENDATION_RUN' } }), 1);
});

test('a failure mid-transaction leaves no partial Plan/PlanVehicle state behind', async () => {
  // Force a real failure deep inside generatePlan's transaction (the final
  // AuditEvent.create) without touching production code, by dropping the
  // table it writes to. This is the last test in the file: the whole
  // disposable test database is dropped in after() immediately afterward,
  // so there is no need to recreate the table.
  await db.sequelize.query('DROP TABLE audit_events CASCADE');

  await assert.rejects(planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' }));

  const planCount = await db.Plan.count();
  assert.equal(planCount, 0, 'the Plan row from the failed transaction must have been rolled back');
  const planVehicleCount = await db.PlanVehicle.count();
  assert.equal(planVehicleCount, 0, 'plan_vehicles rows from the failed transaction must have been rolled back');
});
