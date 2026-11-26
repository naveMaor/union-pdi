'use strict';

const db = require('../models');
const { PlanServiceError, assertPlannerRole } = require('./planService');

const BLOCKER_CODES = ['RECALL', 'WORK_STOP', 'MISSING_ACCESSORY', 'DAMAGE', 'ZERO_KM_STOP'];

async function loadVehicle(vehicleId, transaction) {
  const vehicle = await db.Vehicle.findByPk(vehicleId, { transaction });
  if (!vehicle) {
    throw new PlanServiceError('VEHICLE_NOT_FOUND', `${vehicleId} does not exist`);
  }
  return vehicle;
}

/**
 * Adds an active blocker to a vehicle (SPEC §9). A vehicle property, not a plan
 * property — updates vehicles.active_blocker directly regardless of plan status.
 * If the vehicle is currently a plan member, plan membership is never touched
 * here; it's left to the planner to exclude it or clear the blocker (editable
 * plans) or is purely informational (locked plans) — enforced at read/submit time,
 * not here.
 */
async function addBlocker({ actorName, actorRole, vehicleId, blockerCode }) {
  assertPlannerRole(actorRole);
  if (!BLOCKER_CODES.includes(blockerCode)) {
    throw new PlanServiceError('INVALID_BLOCKER_CODE', `${blockerCode} is not a valid blocker code`);
  }

  return db.sequelize.transaction(async (transaction) => {
    const vehicle = await loadVehicle(vehicleId, transaction);
    const previousBlocker = vehicle.active_blocker;

    await vehicle.update({ active_blocker: blockerCode }, { transaction });

    await db.AuditEvent.create(
      {
        plan_id: null,
        vehicle_id: vehicleId,
        event_type: 'BLOCKER_ADDED',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { previous_blocker: previousBlocker, new_blocker: blockerCode },
      },
      { transaction }
    );

    return { vehicle: vehicle.toJSON() };
  });
}

/**
 * Removes a vehicle's active blocker, setting it back to NONE. Does not add the
 * vehicle anywhere — only affects future eligibility (next regeneration) or, if
 * already a plan member, stops it being flagged as blocked for warning purposes.
 */
async function removeBlocker({ actorName, actorRole, vehicleId }) {
  assertPlannerRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    const vehicle = await loadVehicle(vehicleId, transaction);
    if (vehicle.active_blocker === 'NONE') {
      throw new PlanServiceError('NO_ACTIVE_BLOCKER', `${vehicleId} has no active blocker to remove`);
    }

    const previousBlocker = vehicle.active_blocker;
    await vehicle.update({ active_blocker: 'NONE' }, { transaction });

    await db.AuditEvent.create(
      {
        plan_id: null,
        vehicle_id: vehicleId,
        event_type: 'BLOCKER_REMOVED',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { previous_blocker: previousBlocker, new_blocker: 'NONE' },
      },
      { transaction }
    );

    return { vehicle: vehicle.toJSON() };
  });
}

module.exports = { addBlocker, removeBlocker, BLOCKER_CODES };
