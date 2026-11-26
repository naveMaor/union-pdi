'use strict';

const REASONS = {
  NOT_CUSTOMS_RELEASED: 'NOT_CUSTOMS_RELEASED',
  ACTIVE_BLOCKER: 'ACTIVE_BLOCKER',
  MANUALLY_EXCLUDED: 'MANUALLY_EXCLUDED',
  HARD_QUOTA_EXCEEDED: 'HARD_QUOTA_EXCEEDED',
  OVER_CAPACITY: 'OVER_CAPACITY',
};

function eligibilityReason(vehicle, excludedVehicleIds) {
  if (!vehicle.customs_released) return REASONS.NOT_CUSTOMS_RELEASED;
  if (vehicle.active_blocker !== 'NONE') return REASONS.ACTIVE_BLOCKER;
  if (excludedVehicleIds.has(vehicle.vehicle_id)) return REASONS.MANUALLY_EXCLUDED;
  return null;
}

function compareFifo(a, b) {
  if (a.envelope_date !== b.envelope_date) return a.envelope_date < b.envelope_date ? -1 : 1;
  if (a.vehicle_id === b.vehicle_id) return 0;
  return a.vehicle_id < b.vehicle_id ? -1 : 1;
}

/**
 * Pure, single-pass recommendation algorithm (SPEC §7). No DB/HTTP access -
 * takes plain data in, returns plain data out.
 *
 * @param {object} params
 * @param {object[]} params.vehicles - vehicle rows (same shape as the Vehicle model attributes)
 * @param {Iterable<string>} params.excludedVehicleIds - vehicle_ids manually excluded for this plan date
 * @param {Object.<string, {target: number, type: 'HARD'|'FLEX'}>} params.brandQuotas - quota config by brand
 * @param {number} params.dailyCapacity
 * @returns {{
 *   selected: object[],
 *   exclusions: {vehicle_id: string, reason: string}[],
 *   brandQuotaUtilization: Object.<string, {selected: number, target: number, type: string, overage: number}>,
 *   sourceLocationCounts: Object.<string, number>,
 * }}
 */
function generateRecommendation({ vehicles, excludedVehicleIds, brandQuotas, dailyCapacity }) {
  const excluded = new Set(excludedVehicleIds);

  const candidates = [];
  const exclusions = [];

  for (const vehicle of vehicles) {
    const reason = eligibilityReason(vehicle, excluded);
    if (reason) {
      exclusions.push({ vehicle_id: vehicle.vehicle_id, reason });
    } else {
      candidates.push(vehicle);
    }
  }

  candidates.sort(compareFifo);

  const selected = [];
  const brandCounts = {};
  const sourceLocationCounts = {};

  for (const vehicle of candidates) {
    if (selected.length >= dailyCapacity) {
      exclusions.push({ vehicle_id: vehicle.vehicle_id, reason: REASONS.OVER_CAPACITY });
      continue;
    }

    const quota = brandQuotas[vehicle.brand];
    const currentCount = brandCounts[vehicle.brand] || 0;
    if (quota && quota.type === 'HARD' && currentCount >= quota.target) {
      exclusions.push({ vehicle_id: vehicle.vehicle_id, reason: REASONS.HARD_QUOTA_EXCEEDED });
      continue;
    }

    selected.push(vehicle);
    brandCounts[vehicle.brand] = currentCount + 1;
    sourceLocationCounts[vehicle.source_location] = (sourceLocationCounts[vehicle.source_location] || 0) + 1;
  }

  const brandQuotaUtilization = {};
  for (const brand of Object.keys(brandQuotas)) {
    const quota = brandQuotas[brand];
    const selectedCount = brandCounts[brand] || 0;
    brandQuotaUtilization[brand] = {
      selected: selectedCount,
      target: quota.target,
      type: quota.type,
      overage: quota.type === 'FLEX' ? Math.max(0, selectedCount - quota.target) : 0,
    };
  }

  return { selected, exclusions, brandQuotaUtilization, sourceLocationCounts };
}

module.exports = { generateRecommendation, REASONS };
