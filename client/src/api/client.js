const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', role, body, signal, headers: extraHeaders } = {}) {
  const headers = { 'x-demo-role': role, ...extraHeaders };
  // Only set Content-Type when there's an actual body — Fastify's JSON parser
  // rejects a request that declares application/json but sends no body.
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error || 'UNKNOWN_ERROR',
      payload?.message || response.statusText
    );
  }

  return payload;
}

function toQueryString(params) {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

export const api = {
  getPlan: (role, { signal } = {}) => request('/plan', { role, signal }),
  generatePlan: (role, { confirm = false } = {}) =>
    request('/plan/generate', { method: 'POST', role, body: confirm ? { confirm: true } : undefined }),
  submitForShipping: (role) => request('/plan/submit', { method: 'POST', role }),
  approveForShipping: (role) => request('/plan/approve', { method: 'POST', role }),
  returnToPlanner: (role, comment) => request('/plan/return', { method: 'POST', role, body: { comment } }),
  excludeVehicle: (role, vehicleId, body) =>
    request(`/plan/vehicles/${encodeURIComponent(vehicleId)}/exclude`, { method: 'POST', role, body }),
  cancelExclusion: (role, vehicleId) =>
    request(`/plan/vehicles/${encodeURIComponent(vehicleId)}/cancel-exclusion`, { method: 'POST', role }),
  getReplacement: (role, { signal } = {}) => request('/plan/replacement', { role, signal }),
  confirmReplacement: (role, vehicleId) =>
    request('/plan/replacement/confirm', { method: 'POST', role, body: { vehicleId } }),
  addBlocker: (role, vehicleId, blockerCode) =>
    request(`/vehicles/${encodeURIComponent(vehicleId)}/blocker`, {
      method: 'POST', role, body: { blockerCode },
    }),
  removeBlocker: (role, vehicleId) =>
    request(`/vehicles/${encodeURIComponent(vehicleId)}/blocker`, { method: 'DELETE', role }),
  getVehicles: (role, params, { signal } = {}) =>
    request(`/vehicles${toQueryString(params)}`, { role, signal }),
  getSettings: (role, { signal } = {}) => request('/settings', { role, signal }),
  updateSettings: (role, body) => request('/settings', { method: 'PUT', role, body }),
  demoReset: (role, token) =>
    request('/demo/reset', {
      method: 'POST',
      role,
      body: { confirm: 'RESET_DEMO_DATA' },
      headers: { 'x-demo-reset-token': token },
    }),
};
