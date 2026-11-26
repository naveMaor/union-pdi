import { useApiResource } from './useApiResource';
import { api } from '../api/client';

export function usePlanSummary(role) {
  return useApiResource((signal) => api.getPlan(role, { signal }), [role]);
}

export function useSettings(role) {
  return useApiResource((signal) => api.getSettings(role, { signal }), [role]);
}

export function useVehicles(role, params) {
  const key = JSON.stringify(params);
  return useApiResource((signal) => api.getVehicles(role, params, { signal }), [role, key]);
}

// Unfiltered snapshot of all 300 vehicles, used to derive the global stat
// tiles client-side — GET /vehicles' own `count` is always scoped to whatever
// filters are currently applied, never a global total, so the tiles must never
// read it off the filtered table response.
export function useAllVehicles(role) {
  return useApiResource((signal) => api.getVehicles(role, { tab: 'all' }, { signal }), [role]);
}
