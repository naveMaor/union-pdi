'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { PLAN_DATE } = require('./planService');

/**
 * Builds the read-only summary of the current plan (SPEC §5.1): status, the
 * selected vehicles, brand quota utilization and source-location counts
 * recomputed from the plan's ACTUAL current membership (not a cached result
 * from the last recommendation run, since manual exclusions/replacements can
 * change membership afterward), vehicles in the plan with an active blocker
 * (warning, SPEC §9), and the return comment if the plan was returned.
 */
async function getPlanSummary() {
  const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE } });
  if (!plan) {
    return { plan: null };
  }

  const planVehicles = await db.PlanVehicle.findAll({
    where: { plan_id: plan.id },
    include: [{ model: db.Vehicle }],
  });
  const selected = planVehicles.map((pv) => ({ ...pv.Vehicle.toJSON(), source: pv.source }));

  const brandQuotaUtilization = {};
  for (const [brand, quota] of Object.entries(plan.brand_quotas_snapshot)) {
    brandQuotaUtilization[brand] = { selected: 0, target: quota.quota_target, type: quota.quota_type, overage: 0 };
  }
  for (const vehicle of selected) {
    if (!brandQuotaUtilization[vehicle.brand]) {
      brandQuotaUtilization[vehicle.brand] = { selected: 0, target: 0, type: 'FLEX', overage: 0 };
    }
    brandQuotaUtilization[vehicle.brand].selected += 1;
  }
  for (const utilization of Object.values(brandQuotaUtilization)) {
    if (utilization.type === 'FLEX') {
      utilization.overage = Math.max(0, utilization.selected - utilization.target);
    }
  }

  const sourceLocationCounts = {};
  for (const vehicle of selected) {
    sourceLocationCounts[vehicle.source_location] = (sourceLocationCounts[vehicle.source_location] || 0) + 1;
  }

  const blockerWarnings = selected
    .filter((vehicle) => vehicle.active_blocker !== 'NONE')
    .map((vehicle) => ({ vehicle_id: vehicle.vehicle_id, active_blocker: vehicle.active_blocker }));

  return {
    plan: {
      id: plan.id,
      plan_date: plan.plan_date,
      status: plan.status,
      returned_note: plan.returned_note,
      capacity_snapshot: plan.capacity_snapshot,
      brand_quotas_snapshot: plan.brand_quotas_snapshot,
      last_recommendation_run_at: plan.last_recommendation_run_at,
    },
    selected,
    brandQuotaUtilization,
    sourceLocationCounts,
    blockerWarnings,
    capacity: { selected: selected.length, target: plan.capacity_snapshot },
  };
}

function computeNotInPlanReason(vehicle, context) {
  if (!vehicle.customs_released) return 'NOT_CUSTOMS_RELEASED';
  if (vehicle.active_blocker !== 'NONE') return 'ACTIVE_BLOCKER';
  if (context.excludedVehicleIds.has(vehicle.vehicle_id)) return 'MANUALLY_EXCLUDED';

  const quota = context.brandQuotas[vehicle.brand];
  if (quota && quota.quota_type === 'HARD' && (context.brandCounts[vehicle.brand] || 0) >= quota.quota_target) {
    return 'HARD_QUOTA_EXCEEDED';
  }
  if (context.selectedCount >= context.capacitySnapshot) return 'OVER_CAPACITY';
  // Eligible, not excluded, brand not at HARD quota, plan not at capacity, yet
  // still not a member — possible after manual plan edits shifted membership.
  return 'NOT_SELECTED';
}

/**
 * Lists/searches/filters/sorts all vehicles for the planner screen (SPEC §5.1),
 * annotated with plan membership and, for non-members, the reason they aren't
 * currently in the plan.
 *
 * @param {object} params
 * @param {'in_plan'|'eligible_not_in_plan'|'ineligible'|'all'} [params.tab]
 * @param {string} [params.search] - matched against vehicle_id/demo_vin (substring, case-insensitive)
 * @param {string} [params.brand]
 * @param {string} [params.sourceLocation]
 * @param {boolean} [params.sortByEnvelopeDate] - false/omitted sorts by vehicle_id
 */
async function listVehicles({ tab = 'all', search, brand, sourceLocation, sortByEnvelopeDate } = {}) {
  const where = {};
  if (search) {
    where[Op.or] = [{ vehicle_id: { [Op.iLike]: `%${search}%` } }, { demo_vin: { [Op.iLike]: `%${search}%` } }];
  }
  if (brand) where.brand = brand;
  if (sourceLocation) where.source_location = sourceLocation;

  const vehicles = await db.Vehicle.findAll({
    where,
    order: sortByEnvelopeDate ? [['envelope_date', 'ASC'], ['vehicle_id', 'ASC']] : [['vehicle_id', 'ASC']],
    raw: true,
  });

  const plan = await db.Plan.findOne({ where: { plan_date: PLAN_DATE } });

  let planVehicleIds = new Set();
  let excludedVehicleIds = new Set();
  let brandCounts = {};
  let brandQuotas = {};
  let capacitySnapshot = 0;

  if (plan) {
    const planVehicles = await db.PlanVehicle.findAll({ where: { plan_id: plan.id }, raw: true });
    planVehicleIds = new Set(planVehicles.map((pv) => pv.vehicle_id));

    const activeExclusions = await db.ManualExclusion.findAll({
      where: { plan_id: plan.id, cancelled_at: null },
      raw: true,
    });
    excludedVehicleIds = new Set(activeExclusions.map((row) => row.vehicle_id));

    const inPlanVehicles = await db.Vehicle.findAll({ where: { vehicle_id: Array.from(planVehicleIds) }, raw: true });
    for (const vehicle of inPlanVehicles) {
      brandCounts[vehicle.brand] = (brandCounts[vehicle.brand] || 0) + 1;
    }

    brandQuotas = plan.brand_quotas_snapshot;
    capacitySnapshot = plan.capacity_snapshot;
  }

  const context = { excludedVehicleIds, brandCounts, brandQuotas, capacitySnapshot, selectedCount: planVehicleIds.size };

  const annotated = vehicles.map((vehicle) => {
    const inPlan = planVehicleIds.has(vehicle.vehicle_id);
    return {
      ...vehicle,
      inPlan,
      reason: inPlan ? null : computeNotInPlanReason(vehicle, context),
    };
  });

  const filtered = annotated.filter((vehicle) => {
    if (tab === 'in_plan') return vehicle.inPlan;
    if (tab === 'eligible_not_in_plan') {
      return !vehicle.inPlan && vehicle.customs_released && vehicle.active_blocker === 'NONE';
    }
    if (tab === 'ineligible') return !vehicle.customs_released || vehicle.active_blocker !== 'NONE';
    return true; // 'all'
  });

  return { tab, count: filtered.length, vehicles: filtered };
}

module.exports = { getPlanSummary, listVehicles };
