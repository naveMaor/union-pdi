import { useApiResource } from './useApiResource';
import { api } from '../api/client';

export function usePlanSummary(role, revision) {
  return useApiResource((signal) => api.getPlan(role, { signal }), [role, revision]);
}

export function useSettings(role, revision) {
  return useApiResource((signal) => api.getSettings(role, { signal }), [role, revision]);
}

export function useReplacement(role, revision) {
  return useApiResource((signal) => api.getReplacement(role, { signal }), [role, revision]);
}

export function useVehicles(role, params, revision) {
  const key = JSON.stringify(params);
  return useApiResource((signal) => api.getVehicles(role, params, { signal }), [role, key, revision]);
}

// Unfiltered snapshot of all 300 vehicles, used to derive the global stat
// tiles client-side — GET /vehicles' own `count` is always scoped to whatever
// filters are currently applied, never a global total, so the tiles must never
// read it off the filtered table response.
export function useAllVehicles(role, revision) {
  return useApiResource((signal) => api.getVehicles(role, { tab: 'all' }, { signal }), [role, revision]);
}
