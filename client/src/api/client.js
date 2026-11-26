const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', role, body, signal } = {}) {
  const headers = { 'x-demo-role': role };
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
  getVehicles: (role, params, { signal } = {}) =>
    request(`/vehicles${toQueryString(params)}`, { role, signal }),
  getSettings: (role, { signal } = {}) => request('/settings', { role, signal }),
};
