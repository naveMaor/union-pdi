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

function assertShippingRole(actorRole) {
  if (actorRole !== 'SHIPPING') {
    throw new PlanServiceError('FORBIDDEN_ROLE', `Role ${actorRole} is not authorized to perform this action`);
  }
}

function assertAdminRole(actorRole) {
  if (actorRole !== 'ADMIN') {
    throw new PlanServiceError('FORBIDDEN_ROLE', `Role ${actorRole} is not authorized to perform this action`);
  }
}

function assertPendingShipping(plan) {
  if (!plan) {
    throw new PlanServiceError('PLAN_NOT_FOUND', `No plan exists yet for ${PLAN_DATE}`);
  }
  if (plan.status !== 'PENDING_SHIPPING') {
    throw new PlanServiceError(
      'PLAN_NOT_PENDING_SHIPPING',
      `Plan for ${PLAN_DATE} is ${plan.status}, not PENDING_SHIPPING`
    );
  }
}

// A reset is an exclusive-vs-all-business-mutations operation: every mutating
// service transaction (plan, blocker, settings) takes this key in SHARED mode
// before doing any writes, and the demo reset takes it in EXCLUSIVE mode. This
// lets ordinary business mutations continue to run concurrently with each
// other (shared locks never conflict with each other), while a reset waits for
// any of them already in flight to finish, and blocks new ones from starting,
// for the duration of its own transaction.
const BUSINESS_VS_RESET_LOCK_KEY = 'demo-reset:business-vs-reset';
// A separate key, held only by a reset itself, so two concurrent reset
// attempts fail fast against each other (try-lock) instead of one silently
// queuing behind the other.
const RESET_MUTEX_LOCK_KEY = 'demo-reset:reset-mutex';

async function acquireBusinessMutationLock(transaction) {
  await db.sequelize.query('SELECT pg_advisory_xact_lock_shared(hashtext(:key), 0)', {
    replacements: { key: BUSINESS_VS_RESET_LOCK_KEY },
    transaction,
  });
}

// Called only by demoResetService. Fails fast with RESET_IN_PROGRESS against a
// concurrent reset, then blocks (briefly — ordinary business mutations are
// fast) until no business mutation is still mid-transaction.
async function acquireResetLocks(transaction) {
  const [{ acquired }] = await db.sequelize.query(
    'SELECT pg_try_advisory_xact_lock(hashtext(:key), 0) AS acquired',
    { replacements: { key: RESET_MUTEX_LOCK_KEY }, transaction, type: db.Sequelize.QueryTypes.SELECT }
  );
  if (!acquired) {
    throw new PlanServiceError('RESET_IN_PROGRESS', 'A demo reset is already running');
  }
  await db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key), 0)', {
    replacements: { key: BUSINESS_VS_RESET_LOCK_KEY },
    transaction,
  });
}

// Serializes concurrent operations against this plan date, including the race
// between two callers that both see no existing plan row yet. Also takes the
// business-vs-reset shared lock first, so plan mutations are protected against
// a concurrent demo reset the same way blocker/settings mutations are.
async function acquirePlanLock(transaction) {
  await acquireBusinessMutationLock(transaction);
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
 * @param {boolean} [params.confirm] - must be true to regenerate an existing editable plan
 * @returns {Promise<{plan: object, selected: object[], exclusions: object[], brandQuotaUtilization: object, sourceLocationCounts: object}>}
 */
async function generatePlan({ actorName, actorRole, confirm }) {
  assertPlannerRole(actorRole);

  // The post-lock read must see a competing generation that committed while we waited.
  const options = { isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED };
  return db.sequelize.transaction(options, async (transaction) => {
    await acquirePlanLock(transaction);

    let plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    const isFirstGeneration = !plan;

    if (plan && !EDITABLE_STATUSES.includes(plan.status)) {
      throw new PlanServiceError(
        'PLAN_LOCKED',
        `Plan for ${PLAN_DATE} is ${plan.status} and cannot be regenerated`
      );
    }

    if (plan && confirm !== true) {
      const error = new PlanServiceError(
        'CONFIRMATION_REQUIRED',
        'A plan already exists for this date. Resend with { "confirm": true } to regenerate it.'
      );
      error.planStatus = plan.status;
      throw error;
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

/**
 * Approves the plan for shipping (SPEC §8.1, §5.2). SHIPPING role only, only
 * from PENDING_SHIPPING. Compares actual per-source-location vehicle counts
 * against the CURRENT shipping_capacities settings — read live at approval
 * time, never from a plan snapshot (SPEC §5.3's "approval uses the current
 * shipping capacity settings"). Rejects server-side if any source is over
 * capacity; the UI cannot bypass this.
 */
async function approveForShipping({ actorName, actorRole }) {
  assertShippingRole(actorRole);

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertPendingShipping(plan);

    const planVehicles = await db.PlanVehicle.findAll({ where: { plan_id: plan.id }, transaction, raw: true });
    const vehicleIds = planVehicles.map((pv) => pv.vehicle_id);
    const vehicles = await db.Vehicle.findAll({ where: { vehicle_id: vehicleIds }, transaction, raw: true });

    const countsBySource = {};
    for (const vehicle of vehicles) {
      countsBySource[vehicle.source_location] = (countsBySource[vehicle.source_location] || 0) + 1;
    }

    const shippingCapacities = await db.ShippingCapacity.findAll({ transaction, raw: true });
    const violations = [];
    for (const capacityRow of shippingCapacities) {
      const count = countsBySource[capacityRow.source_location] || 0;
      if (count > capacityRow.capacity) {
        violations.push({ source_location: capacityRow.source_location, count, capacity: capacityRow.capacity });
      }
    }

    if (violations.length > 0) {
      throw new PlanServiceError(
        'SHIPPING_CAPACITY_EXCEEDED',
        `Shipping capacity exceeded for: ${violations.map((v) => `${v.source_location} (${v.count}/${v.capacity})`).join(', ')}`
      );
    }

    const fromStatus = plan.status;
    await plan.update({ status: 'APPROVED' }, { transaction });

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: null,
        event_type: 'STATUS_TRANSITION',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { from: fromStatus, to: 'APPROVED' },
      },
      { transaction }
    );

    return { plan: plan.toJSON() };
  });
}

/**
 * Returns the plan to the planner for correction (SPEC §8.1). SHIPPING role
 * only, only from PENDING_SHIPPING, back to RETURNED. A nonblank comment is
 * required and stored in plans.returned_note for the planner to see.
 */
async function returnToPlanner({ actorName, actorRole, comment }) {
  assertShippingRole(actorRole);
  if (typeof comment !== 'string' || !comment.trim()) {
    throw new PlanServiceError('COMMENT_REQUIRED', 'A nonblank comment is required to return a plan');
  }

  return db.sequelize.transaction(async (transaction) => {
    await acquirePlanLock(transaction);

    const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE }, transaction });
    assertPendingShipping(plan);

    const fromStatus = plan.status;
    await plan.update({ status: 'RETURNED', returned_note: comment }, { transaction });

    await db.AuditEvent.create(
      {
        plan_id: plan.id,
        vehicle_id: null,
        event_type: 'STATUS_TRANSITION',
        actor_name: actorName,
        actor_role: actorRole,
        payload: { from: fromStatus, to: 'RETURNED', comment },
      },
      { transaction }
    );

    return { plan: plan.toJSON() };
  });
}

module.exports = {
  generatePlan,
  submitForShipping,
  approveForShipping,
  returnToPlanner,
  PlanServiceError,
  PLAN_DATE,
  EDITABLE_STATUSES,
  assertPlannerRole,
  assertShippingRole,
  assertAdminRole,
  assertEditablePlan,
  acquirePlanLock,
  acquireBusinessMutationLock,
  acquireResetLocks,
};
