import { PLAN_DATE } from './constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_DAY = Date.parse(PLAN_DATE);

export function formatDate(isoDate) {
  return isoDate?.split('-').reverse().join('.') || '—';
}

export function envelopeAge(isoDate) {
  // ISO date-only strings parse at UTC midnight, so local time and DST cannot
  // affect the age for the fixed planning date.
  return (PLAN_DAY - Date.parse(isoDate)) / DAY_MS;
}

export function countVehicleTabs(vehicles) {
  // Count badges from the unfiltered snapshot. The API filters the displayed rows.
  const counts = { all: vehicles.length, in_plan: 0, eligible_not_in_plan: 0, ineligible: 0 };
  for (const vehicle of vehicles) {
    const eligible = vehicle.customs_released && vehicle.active_blocker === 'NONE' && !vehicle.exclusion;
    if (vehicle.inPlan) counts.in_plan++;
    if (!eligible) counts.ineligible++;
    else if (!vehicle.inPlan) counts.eligible_not_in_plan++;
  }
  return counts;
}
