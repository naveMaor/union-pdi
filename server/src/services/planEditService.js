'use strict';

const db = require('../models');
const { generateRecommendation } = require('./recommendation');
const {
  PlanServiceError,
  PLAN_DATE,
  assertPlannerRole,
  assertEditablePlan,
  acquirePlanLock,
} = require('./planService');

const REASON_CODES = [
  'PRIORITIZED_OTHER',
  'SECURITY_FORCES',
  'OPERATIONAL_DELAY',
  'ACCESSORY_ISSUE',
  'AUTHORITY_INSTRUCTION',
  'OTHER',
];

function assertValidExclusionInput(reasonCode, note) {
  if (!REASON_CODES.includes(reasonCode)) {
    throw new PlanServiceError('INVALID_REASON_CODE', `${reasonCode} is not a valid exclusion reason code`);
  }
  if (reasonCode === 'OTHER' && (!note || !note.trim())) {
    throw new PlanServiceError('NOTE_REQUIRED', "A note is required when reason_code is 'OTHER'");
  }
}

/**
 * Computes the single suggested replacement for a plan (SPEC §8.4): the first
 * FIFO-eligible vehicle not already in the plan, not manually excluded, and not
 * breaching a HARD brand quota — evaluated against the plan's own
 * capacity_snapshot/brand_quotas_snapshot (the parameters in effect when this
 * plan was generated), never against current live settings (SPEC §5.3).
 *
 * Reuses the pure recommendation algorithm: the candidate pool excludes vehicles
 * already in the plan, and each HARD brand's remaining room is passed in as an
 * adjusted target so the single-pass quota check in generateRecommendation
 * reflects what's already been used by the plan's current membership.
 */
async function computeSuggestedReplacement(plan, transaction) {
  const planVehicles = await db.PlanVehicle.findAll({ where: { plan_id: plan.id }, transaction, raw: true });
  const planVehicleIds = new Set(planVehicles.map((pv) => pv.vehicle_id));

  const activeExclusions = await db.ManualExclusion.findAll({
    where: { plan_id: plan.id, cancelled_at: null },
    transaction,
    raw: true,
  });
  const excludedVehicleIds = activeExclusions.map((row) => row.vehicle_id);

  const vehiclesInPlan = await db.Vehicle.findAll({
    where: { vehicle_id: Array.from(planVehicleIds) },
    transaction,
    raw: true,
  });
  const brandCounts = {};
  for (const vehicle of vehiclesInPlan) {
    brandCounts[vehicle.brand] = (brandCounts[vehicle.brand] || 0) + 1;
  }

  const brandQuotas = {};
  for (const [brand, quota] of Object.entries(plan.brand_quotas_snapshot)) {
    const used = brandCounts[brand] || 0;
    brandQuotas[brand] = {
      type: quota.quota_type,
      target: quota.quota_type === 'HARD' ? Math.max(0, quota.quota_target - used) : quota.quota_target,
    };
  }

  const allVehicles = await db.Vehicle.findAll({ transaction, raw: true });
  const candidatePool = allVehicles.filter((vehicle) => !planVehicleIds.has(vehicle.vehicle_id));

  const result = generateRecommendation({
    vehicles: candidatePool,
    excludedVehicleIds,
    brandQuotas,
    dailyCapacity: 1,
  });

  return result.selected[0] || null;
}

/**
 * Manually excludes a vehicle from the current plan (SPEC §8.3): removes it from
 * plan_vehicles immediately (not deferred to the next regeneration), records the
 * exclusion, and returns the single suggested replacement, if any.
 *
 * @param {object} params
 * @param {string} params.actorName
 * @param {string} params.actorRole - must be 'PLANNER'
 * @param {string} params.vehicleId
 * @param {string} params.reasonCode - one of the 6 SPEC §8.3 reason codes
 * @param {string} [params.note] - required (non-blank) when reasonCode is 'OTHER'
 */
async function excludeVehicle({ actorName, actorRole, vehicleId, reasonCode, note }) {
  assertPlannerRole(actorRole);
  assertValidExclusionInput(reasonCode, note);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertEditablePlan(plan);

    const planVehicle = await db.PlanVehicle.findOne({
      where: { plan_id: plan.id, vehicle_id: vehicleId },
      transaction,
    });
    if (!planVehicle) {
      throw new PlanServiceError('VEHICLE_NOT_IN_PLAN', `${vehicleId} is not currently in the plan`);
    }

    const existingActiveExclusion = await db.ManualExclusion.findOne({
      where: { plan_id: plan.id, vehicle_id: vehicleId, cancelled_at: null },
      transaction,
    });
    if (existingActiveExclusion) {
      throw new PlanServiceError('ALREADY_EXCLUDED', `${vehicleId} is already manually excluded from this plan`);
    }

    const exclusion = await db.ManualExclusion.create(
      {
        plan_id: plan.id,
        vehicle_id: vehicleId,
        reason_code: reasonCode,
        note: note || null,
        excluded_by_name: actorName,
        excluded_by_role: actorRole,
      },
      { transaction }
    );

    await planVehicle.destroy({ transaction });

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: vehicleId,
        event_type: 'MANUAL_EXCLUSION',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { reason_code: reasonCode, note: note || null },
      },
      { transaction }
    );

    const suggestedReplacement = await computeSuggestedReplacement(plan, transaction);

    return {
      plan: plan.toJSON(),
      exclusion: exclusion.toJSON(),
      suggestedReplacement,
    };
  });
}

/**
 * Cancels an active manual exclusion (SPEC §8.3). Does NOT re-add the vehicle to
 * the current plan — it only becomes eligible again on the next regeneration.
 *
 * @param {object} params
 * @param {string} params.actorName
 * @param {string} params.actorRole - must be 'PLANNER'
 * @param {string} params.vehicleId
 */
async function cancelExclusion({ actorName, actorRole, vehicleId }) {
  assertPlannerRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertEditablePlan(plan);

    const exclusion = await db.ManualExclusion.findOne({
      where: { plan_id: plan.id, vehicle_id: vehicleId, cancelled_at: null },
      transaction,
    });
    if (!exclusion) {
      throw new PlanServiceError('NO_ACTIVE_EXCLUSION', `${vehicleId} has no active manual exclusion for this plan`);
    }

    await exclusion.update(
      {
        cancelled_at: new Date(),
        cancelled_by_name: actorName,
        cancelled_by_role: actorRole,
      },
      { transaction }
    );

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: vehicleId,
        event_type: 'EXCLUSION_CANCELLED',
        actor_name: actorName,
        actor_role: actorRole,
        payload: {},
      },
      { transaction }
    );

    return { plan: plan.toJSON(), exclusion: exclusion.toJSON() };
  });
}

/**
 * Confirms adding the suggested replacement vehicle to the plan (SPEC §8.4).
 * Recomputes the suggestion fresh inside this transaction and only proceeds if
 * the caller's vehicleId still matches it — rejects free-form/arbitrary
 * additions and stale suggestions (anything changed since the suggestion was
 * shown to the planner).
 *
 * @param {object} params
 * @param {string} params.actorName
 * @param {string} params.actorRole - must be 'PLANNER'
 * @param {string} params.vehicleId - the vehicle_id the planner was shown as the suggestion
 */
async function confirmReplacement({ actorName, actorRole, vehicleId }) {
  assertPlannerRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertEditablePlan(plan);

    const suggestion = await computeSuggestedReplacement(plan, transaction);
    if (!suggestion || suggestion.vehicle_id !== vehicleId) {
      throw new PlanServiceError(
        'STALE_SUGGESTION',
        `${vehicleId} is not the currently suggested replacement for this plan`
      );
    }

    const planVehicle = await db.PlanVehicle.create(
      { plan_id: plan.id, vehicle_id: vehicleId, source: 'MANUAL' },
      { transaction }
    );

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: vehicleId,
        event_type: 'MANUAL_ADDITION',
        actor_name: actorName,
        actor_role: actorRole,
        payload: {},
      },
      { transaction }
    );

    return { plan: plan.toJSON(), planVehicle: planVehicle.toJSON() };
  });
}

module.exports = { excludeVehicle, cancelExclusion, confirmReplacement, computeSuggestedReplacement };
