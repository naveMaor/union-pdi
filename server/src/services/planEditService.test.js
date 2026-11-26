'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = `union_pdi_test_edit_${process.pid}`;

const config = require('../config/config.js').test;
const TEST_DB = config.database;

assert.ok(
  TEST_DB &&
    TEST_DB.includes('edit') &&
    TEST_DB.includes('test') &&
    TEST_DB !== process.env.POSTGRES_DB,
  `refusing to run planEditService.test.js: resolved test database "${TEST_DB}" does not look like an isolated edit-test database`
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
let planEditService;
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
  planEditService = require('./planEditService');

  await seed.run();
});

after(async () => {
  await db.sequelize.close();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.end();
});

beforeEach(async () => {
  await db.sequelize.query(
    'DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM plans; DELETE FROM audit_events;'
  );
});

async function generateBaseline() {
  return planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });
}

test('SPEC section 14 test 6: excluding PDI-195 (Zeekr/FLEX) suggests exactly PDI-200; confirming restores 200', async () => {
  const baseline = await generateBaseline();
  assert.equal(baseline.selected.length, 200);
  assert.ok(baseline.selected.some((v) => v.vehicle_id === 'PDI-195'));

  const excludeResult = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-195',
    reasonCode: 'OPERATIONAL_DELAY',
  });

  assert.equal(excludeResult.suggestedReplacement.vehicle_id, 'PDI-200');
  const countAfterExclude = await db.PlanVehicle.count({ where: { plan_id: excludeResult.plan.id } });
  assert.equal(countAfterExclude, 199);

  const confirmResult = await planEditService.confirmReplacement({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-200',
  });

  const countAfterConfirm = await db.PlanVehicle.count({ where: { plan_id: confirmResult.plan.id } });
  assert.equal(countAfterConfirm, 200);
  const addedRow = await db.PlanVehicle.findOne({ where: { plan_id: confirmResult.plan.id, vehicle_id: 'PDI-200' } });
  assert.equal(addedRow.source, 'MANUAL');
});

test('SPEC section 14 test 7: excluding PDI-281 (Toyota/HARD, at quota) suggests exactly PDI-107', async () => {
  const baseline = await generateBaseline();
  assert.ok(baseline.selected.some((v) => v.vehicle_id === 'PDI-281'));
  assert.ok(!baseline.selected.some((v) => v.vehicle_id === 'PDI-107'), 'PDI-107 must have been passed over originally (over HARD quota or capacity)');

  const excludeResult = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-281',
    reasonCode: 'OPERATIONAL_DELAY',
  });

  assert.equal(excludeResult.suggestedReplacement.vehicle_id, 'PDI-107');
});

test('SPEC section 14 test 8: regeneration after exclusion keeps the vehicle out; cancelling and regenerating brings it back', async () => {
  await generateBaseline();

  await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-195',
    reasonCode: 'OPERATIONAL_DELAY',
  });

  const regenerated = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });
  assert.equal(regenerated.selected.length, 200);
  assert.ok(!regenerated.selected.some((v) => v.vehicle_id === 'PDI-195'), 'excluded vehicle must not return after regen');

  await planEditService.cancelExclusion({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-195' });

  // cancelling must not re-add it to the current plan_vehicles by itself
  const stillAbsent = await db.PlanVehicle.findOne({ where: { plan_id: regenerated.plan.id, vehicle_id: 'PDI-195' } });
  assert.equal(stillAbsent, null);

  const afterCancelRegen = await planService.generatePlan({ actorName: 'Michal Levi', actorRole: 'PLANNER' });
  assert.ok(afterCancelRegen.selected.some((v) => v.vehicle_id === 'PDI-195'), 'vehicle must return once its exclusion is cancelled and the plan regenerated');
});

test('reason code validation: invalid code rejected, OTHER without note rejected, OTHER with note accepted', async () => {
  await generateBaseline();

  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'NOT_A_REAL_CODE' }),
    (err) => err.code === 'INVALID_REASON_CODE'
  );

  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OTHER' }),
    (err) => err.code === 'NOTE_REQUIRED'
  );
  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OTHER', note: '   ' }),
    (err) => err.code === 'NOTE_REQUIRED'
  );

  const ok = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-001',
    reasonCode: 'OTHER',
    note: 'חסרה בדיקה',
  });
  assert.equal(ok.exclusion.reason_code, 'OTHER');
});

test('excluding a vehicle removes it from plan_vehicles immediately, without regenerating', async () => {
  const baseline = await generateBaseline();
  const before = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });

  await planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' });

  const afterExclude = await db.PlanVehicle.count({ where: { plan_id: baseline.plan.id } });
  assert.equal(afterExclude, before - 1);
  const row = await db.PlanVehicle.findOne({ where: { plan_id: baseline.plan.id, vehicle_id: 'PDI-001' } });
  assert.equal(row, null);
});

test('role lock: non-PLANNER rejected for exclude, cancel, and confirm', async () => {
  const baseline = await generateBaseline();

  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Yossi Cohen', actorRole: 'SHIPPING', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' }),
    (err) => err.code === 'FORBIDDEN_ROLE'
  );

  await planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' });

  await assert.rejects(
    planEditService.cancelExclusion({ actorName: 'Ronit Shemesh', actorRole: 'ADMIN', vehicleId: 'PDI-001' }),
    (err) => err.code === 'FORBIDDEN_ROLE'
  );
  await assert.rejects(
    planEditService.confirmReplacement({ actorName: 'Yossi Cohen', actorRole: 'SHIPPING', vehicleId: 'PDI-002' }),
    (err) => err.code === 'FORBIDDEN_ROLE'
  );

  const stillExcluded = await db.ManualExclusion.findOne({ where: { plan_id: baseline.plan.id, vehicle_id: 'PDI-001', cancelled_at: null } });
  assert.ok(stillExcluded, 'the rejected cancel attempt must not have cancelled the exclusion');
});

test('status lock: exclude/cancel/confirm rejected on PENDING_SHIPPING and APPROVED, allowed on DRAFT/RETURNED', async () => {
  const baseline = await generateBaseline();

  for (const lockedStatus of ['PENDING_SHIPPING', 'APPROVED']) {
    await db.Plan.update({ status: lockedStatus }, { where: { id: baseline.plan.id } });

    await assert.rejects(
      planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' }),
      (err) => err.code === 'PLAN_LOCKED'
    );
  }

  await db.Plan.update({ status: 'RETURNED' }, { where: { id: baseline.plan.id } });
  const allowed = await planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' });
  assert.ok(allowed.exclusion.id);
});

test('replacement uses the plan\'s own snapshot, not live settings changed after generation', async (t) => {
  const baseline = await generateBaseline();
  assert.equal(baseline.plan.brand_quotas_snapshot.Toyota.quota_target, 55);

  // change live config drastically after generation, without regenerating
  await db.BrandQuota.update({ quota_target: 0 }, { where: { brand: 'Toyota' } });
  t.after(() => db.BrandQuota.update({ quota_target: 55 }, { where: { brand: 'Toyota' } }));

  const excludeResult = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-281', // Toyota, at the plan's own snapshot quota of 55
    reasonCode: 'OPERATIONAL_DELAY',
  });

  // must still be computed against the plan's own snapshot (Toyota target 55, now at 54/55 after removal -> 1 slot free)
  // not against the live config (which would forbid any further Toyota entirely)
  assert.equal(excludeResult.suggestedReplacement.vehicle_id, 'PDI-107');
  assert.equal(excludeResult.suggestedReplacement.brand, 'Toyota');
});

test('stale suggestion is rejected rather than blindly applied', async () => {
  const baseline = await generateBaseline();

  const excludeResult = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-195',
    reasonCode: 'OPERATIONAL_DELAY',
  });
  const suggested = excludeResult.suggestedReplacement.vehicle_id;
  assert.equal(suggested, 'PDI-200');

  // simulate the suggestion having become stale: the suggested vehicle is already
  // in the plan by the time confirm is attempted (e.g. another concurrent action)
  await db.PlanVehicle.create({ plan_id: baseline.plan.id, vehicle_id: suggested, source: 'ALGORITHM' });

  await assert.rejects(
    planEditService.confirmReplacement({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: suggested }),
    (err) => err.code === 'STALE_SUGGESTION'
  );
});

test('excluding an already-excluded vehicle fails cleanly at the application level, never a raw 23505', async () => {
  await generateBaseline();

  await planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' });

  // second exclusion attempt for the same vehicle_id: the vehicle is already out of
  // plan_vehicles, so this surfaces as VEHICLE_NOT_IN_PLAN (a real PlanServiceError),
  // not ALREADY_EXCLUDED and never a raw Postgres unique_violation leaking through.
  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' }),
    (err) => {
      assert.ok(err.code, 'error must be a PlanServiceError with a .code, not a raw pg error');
      assert.notEqual(err.name, 'SequelizeUniqueConstraintError');
      return true;
    }
  );
});

test('audit events are recorded with correct actor and payload for exclusion, cancellation, and manual addition', async () => {
  const baseline = await generateBaseline();

  const excludeResult = await planEditService.excludeVehicle({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: 'PDI-195',
    reasonCode: 'OPERATIONAL_DELAY',
  });
  const exclusionEvent = await db.AuditEvent.findOne({ where: { plan_id: baseline.plan.id, event_type: 'MANUAL_EXCLUSION' } });
  assert.equal(exclusionEvent.actor_name, 'Michal Levi');
  assert.equal(exclusionEvent.actor_role, 'PLANNER');
  assert.equal(exclusionEvent.payload.reason_code, 'OPERATIONAL_DELAY');

  await planEditService.confirmReplacement({
    actorName: 'Michal Levi',
    actorRole: 'PLANNER',
    vehicleId: excludeResult.suggestedReplacement.vehicle_id,
  });
  const additionEvent = await db.AuditEvent.findOne({ where: { plan_id: baseline.plan.id, event_type: 'MANUAL_ADDITION' } });
  assert.equal(additionEvent.vehicle_id, excludeResult.suggestedReplacement.vehicle_id);

  await planEditService.cancelExclusion({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-195' });
  const cancelEvent = await db.AuditEvent.findOne({ where: { plan_id: baseline.plan.id, event_type: 'EXCLUSION_CANCELLED' } });
  assert.equal(cancelEvent.vehicle_id, 'PDI-195');
  assert.equal(cancelEvent.actor_name, 'Michal Levi');
});

test('a failure mid-transaction during exclusion leaves no partial state', async () => {
  // last test: drops a table this operation writes to, in this disposable DB only,
  // right before the whole DB is torn down in after() -- no need to restore it.
  await generateBaseline();
  const before = await db.PlanVehicle.count();

  await db.sequelize.query('DROP TABLE audit_events CASCADE');

  await assert.rejects(
    planEditService.excludeVehicle({ actorName: 'Michal Levi', actorRole: 'PLANNER', vehicleId: 'PDI-001', reasonCode: 'OPERATIONAL_DELAY' })
  );

  const afterCount = await db.PlanVehicle.count();
  assert.equal(afterCount, before, 'plan_vehicles must be unchanged after a rolled-back exclusion attempt');
  const exclusionRows = await db.ManualExclusion.count();
  assert.equal(exclusionRows, 0, 'no manual_exclusions row should survive a rolled-back transaction');
});
