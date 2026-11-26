'use strict';

const db = require('../models');
const { generateRecommendation } = require('./recommendation');

const PLAN_DATE = '2026-11-23'; // fixed per SPEC — never derived from the system clock

const EDITABLE_STATUSES = ['DRAFT', 'RETURNED'];

class PlanServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function assertPlannerRole(actorRole) {
  if (actorRole !== 'PLANNER') {
    throw new PlanServiceError('FORBIDDEN_ROLE', `Role ${actorRole} is not authorized to perform this action`);
  }
}

// Serializes concurrent operations against this plan date, including the race
// between two callers that both see no existing plan row yet.
async function acquirePlanLock(transaction) {
  await db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key), 0)', {
    replacements: { key: `plan:${PLAN_DATE}` },
    transaction,
  });
}

function assertEditablePlan(plan) {
  if (!plan) {
    throw new PlanServiceError('PLAN_NOT_FOUND', `No plan exists yet for ${PLAN_DATE}`);
  }
  if (!EDITABLE_STATUSES.includes(plan.status)) {
    throw new PlanServiceError('PLAN_LOCKED', `Plan for ${PLAN_DATE} is ${plan.status} and cannot be edited`);
  }
}

function buildBrandQuotasConfig(brandQuotaRows) {
  const brandQuotas = {};
  for (const row of brandQuotaRows) {
    brandQuotas[row.brand] = { target: row.quota_target, type: row.quota_type };
  }
  return brandQuotas;
}

function buildBrandQuotasSnapshot(brandQuotaRows) {
  const snapshot = {};
  for (const row of brandQuotaRows) {
    snapshot[row.brand] = { quota_target: row.quota_target, quota_type: row.quota_type };
  }
  return snapshot;
}

/**
 * Generates (or regenerates) the recommendation for the fixed plan date, persisting
 * the result. Wraps the pure algorithm in `recommendation.js` with Sequelize access,
 * role enforcement, status-transition rules (SPEC §8.1/§8.2) and audit logging.
 *
 * @param {object} params
 * @param {string} params.actorName
 * @param {string} params.actorRole - must be 'PLANNER'
 * @returns {Promise<{plan: object, selected: object[], exclusions: object[], brandQuotaUtilization: object, sourceLocationCounts: object}>}
 */
async function generatePlan({ actorName, actorRole }) {
  assertPlannerRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    let plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    const isFirstGeneration = !plan;

    if (plan && !EDITABLE_STATUSES.includes(plan.status)) {
      throw new PlanServiceError(
        'PLAN_LOCKED',
        `Plan for ${PLAN_DATE} is ${plan.status} and cannot be regenerated`
      );
    }

    // Sequential, not Promise.all: these share one transaction/connection, and
    // pg does not support concurrent queries on the same client.
    const settings = await db.Setting.findByPk(1, { transaction });
    const brandQuotaRows = await db.BrandQuota.findAll({ transaction });
    const vehicles = await db.Vehicle.findAll({ transaction, raw: true });
    const activeExclusions = plan
      ? await db.ManualExclusion.findAll({
          where: { plan_id: plan.id, cancelled_at: null },
          transaction,
        })
      : [];

    const brandQuotas = buildBrandQuotasConfig(brandQuotaRows);
    const excludedVehicleIds = activeExclusions.map((row) => row.vehicle_id);

    const result = generateRecommendation({
      vehicles,
      excludedVehicleIds,
      brandQuotas,
      dailyCapacity: settings.daily_capacity,
    });

    const capacitySnapshot = settings.daily_capacity;
    const brandQuotasSnapshot = buildBrandQuotasSnapshot(brandQuotaRows);
    const now = new Date();

    if (isFirstGeneration) {
      plan = await db.Plan.create(
        {
          plan_date: PLAN_DATE,
          status: 'DRAFT',
          capacity_snapshot: capacitySnapshot,
          brand_quotas_snapshot: brandQuotasSnapshot,
          last_recommendation_run_at: now,
        },
        { transaction }
      );

      await db.AuditEvent.create(
        {
          plan_id: plan.id,
          vehicle_id: null,
          event_type: 'STATUS_TRANSITION',
          actor_name: actorName,
          actor_role: actorRole,
          payload: { from: null, to: 'DRAFT' },
        },
        { transaction }
      );
    } else {
      await plan.update(
        {
          capacity_snapshot: capacitySnapshot,
          brand_quotas_snapshot: brandQuotasSnapshot,
          last_recommendation_run_at: now,
        },
        { transaction }
      );
    }

    // Regeneration computes the plan from scratch (SPEC §8.2): clear both the
    // previous algorithmic selection and any manual additions, then insert the
    // fresh selection. Manual exclusions live in their own table and are untouched.
    await db.PlanVehicle.destroy({ where: { plan_id: plan.id }, transaction });
    await db.PlanVehicle.bulkCreate(
      result.selected.map((vehicle) => ({
        plan_id: plan.id,
        vehicle_id: vehicle.vehicle_id,
        source: 'ALGORITHM',
      })),
      { transaction }
    );

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: null,
        event_type: 'RECOMMENDATION_RUN',
        actor_name: actorName,
        actor_role: actorRole,
        payload: {
          selected_count: result.selected.length,
          capacity: capacitySnapshot,
          brand_quota_utilization: result.brandQuotaUtilization,
          source_location_counts: result.sourceLocationCounts,
        },
      },
      { transaction }
    );

    return {
      plan: plan.toJSON(),
      selected: result.selected,
      exclusions: result.exclusions,
      brandQuotaUtilization: result.brandQuotaUtilization,
      sourceLocationCounts: result.sourceLocationCounts,
    };
  });
}

/**
 * Returns the current Plan row for the fixed plan date, or null if none exists
 * yet. Read-only, no lock — used by the API layer to decide whether to require
 * an explicit regeneration-confirmation flag before calling generatePlan.
 */
async function getCurrentPlan() {
  return db.Plan.findOne({ where: { plan_date: PLAN_DATE } });
}

/**
 * Submits the current plan for shipping approval (SPEC §8.1). Requires PLANNER
 * role, an editable plan (DRAFT/RETURNED) that is non-empty, and every current
 * member to still be eligible (customs_released=true AND active_blocker='NONE') —
 * a blocker added to a plan member after generation blocks submission until the
 * planner excludes the vehicle or clears the blocker (SPEC §9). Does not check
 * shipping capacity — that happens at approval time, not here.
 */
async function submitForShipping({ actorName, actorRole }) {
  assertPlannerRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertEditablePlan(plan);

    const planVehicles = await db.PlanVehicle.findAll({ where: { plan_id: plan.id }, transaction, raw: true });
    if (planVehicles.length === 0) {
      throw new PlanServiceError('EMPTY_PLAN', 'Plan has no vehicles and cannot be submitted');
    }

    const vehicleIds = planVehicles.map((pv) => pv.vehicle_id);
    const vehicles = await db.Vehicle.findAll({ where: { vehicle_id: vehicleIds }, transaction, raw: true });
    const ineligibleVehicleIds = vehicles
      .filter((vehicle) => !vehicle.customs_released || vehicle.active_blocker !== 'NONE')
      .map((vehicle) => vehicle.vehicle_id);

    if (ineligibleVehicleIds.length > 0) {
      throw new PlanServiceError(
        'INELIGIBLE_VEHICLES_IN_PLAN',
        `Plan contains ineligible vehicles: ${ineligibleVehicleIds.join(', ')}`
      );
    }

    const fromStatus = plan.status;
    await plan.update({ status: 'PENDING_SHIPPING' }, { transaction });

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: null,
        event_type: 'STATUS_TRANSITION',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { from: fromStatus, to: 'PENDING_SHIPPING' },
      },
      { transaction }
    );

    return { plan: plan.toJSON() };
  });
}

module.exports = {
  generatePlan,
  submitForShipping,
  getCurrentPlan,
  PlanServiceError,
  PLAN_DATE,
  EDITABLE_STATUSES,
  assertPlannerRole,
  assertEditablePlan,
  acquirePlanLock,
};
