'use strict';

const db = require('../models');
const {
  parseVehiclesCsv,
  CSV_PATH,
  DEFAULT_SETTINGS,
  DEFAULT_BRAND_QUOTAS,
  DEFAULT_SHIPPING_CAPACITIES,
} = require('../scripts/seed');
const { acquireResetLocks } = require('./planService');

// All vehicle columns except the primary key — restored verbatim from the
// original CSV on every reset, in one upsert.
const VEHICLE_UPDATE_COLUMNS = [
  'demo_vin',
  'brand',
  'model',
  'source_location',
  'population',
  'customer_segment',
  'envelope_date',
  'requested_delivery_date',
  'customs_released',
  'active_blocker',
];

/**
 * Demo-only, off-by-default destructive reset (see routes/demoResetRoutes.js
 * for the gating this sits behind). Restores the database to the exact
 * original seed state: all 300 vehicles reset to their CSV values, settings/
 * brand quotas/shipping capacities reset to SPEC defaults, and the plan date
 * returned to a null-plan state (no plans, plan membership, manual
 * exclusions or prior audit history). Everything in one transaction: either
 * all of it happens, or none of it does.
 */
async function resetDemoData({ actorName, actorRole }) {
  const vehicles = parseVehiclesCsv(CSV_PATH);
  const { id: _settingsId, ...settingsUpdate } = DEFAULT_SETTINGS;

  return db.sequelize.transaction(async (transaction) => {
    await acquireResetLocks(transaction);

    // Children first (FK-safe order) — restores the null-plan state. SPEC has
    // no "delete plan" endpoint for normal use; this demo-only path is
    // explicitly exempt from that rule, and is documented as such.
    await db.AuditEvent.destroy({ where: {}, transaction });
    await db.PlanVehicle.destroy({ where: {}, transaction });
    await db.ManualExclusion.destroy({ where: {}, transaction });
    await db.Plan.destroy({ where: {}, transaction });

    // Reuses seed.js's own CSV parsing (not duplicated here) to restore every
    // mutable vehicle column to its exact original value in one upsert.
    await db.Vehicle.bulkCreate(vehicles, {
      updateOnDuplicate: VEHICLE_UPDATE_COLUMNS,
      transaction,
    });

    await db.Setting.update(settingsUpdate, { where: { id: 1 }, transaction });
    for (const quota of DEFAULT_BRAND_QUOTAS) {
      await db.BrandQuota.update(
        { quota_target: quota.quota_target, quota_type: quota.quota_type },
        { where: { brand: quota.brand }, transaction }
      );
    }
    for (const capacity of DEFAULT_SHIPPING_CAPACITIES) {
      await db.ShippingCapacity.update(
        { capacity: capacity.capacity },
        { where: { source_location: capacity.source_location }, transaction }
      );
    }

    // The reset itself is an audited action, not a silent wipe — this is the
    // only audit row left afterward, by design.
    await db.AuditEvent.create(
      {
        plan_id: null,
        vehicle_id: null,
        event_type: 'DEMO_RESET',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { restored_vehicle_count: vehicles.length },
      },
      { transaction }
    );

    const vehicleCount = await db.Vehicle.count({ transaction });
    return { vehicleCount };
  });
}

module.exports = { resetDemoData };
