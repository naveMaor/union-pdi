'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { generateRecommendation, REASONS } = require('./recommendation');
const { parseVehiclesCsv } = require('../scripts/seed');

const CSV_PATH = path.resolve(__dirname, '..', '..', '..', 'docs', 'assignment', 'pdi_seed_300_vehicles.csv');

const DEFAULT_BRAND_QUOTAS = {
  Toyota: { target: 55, type: 'HARD' },
  Lexus: { target: 36, type: 'HARD' },
  Geely: { target: 32, type: 'FLEX' },
  GAC: { target: 22, type: 'HARD' },
  Zeekr: { target: 28, type: 'FLEX' },
};

function loadCsvVehicles() {
  return parseVehiclesCsv(CSV_PATH);
}

let vehicleCounter = 0;
function fixtureVehicle(overrides = {}) {
  vehicleCounter += 1;
  return {
    vehicle_id: `FIX-${String(vehicleCounter).padStart(3, '0')}`,
    demo_vin: `DEMO-${vehicleCounter}`,
    brand: 'Toyota',
    model: 'TestModel',
    source_location: 'נמל אשדוד',
    population: 'CUSTOMER',
    customer_segment: 'GENERAL',
    envelope_date: '2026-01-01',
    requested_delivery_date: '2026-02-01',
    customs_released: true,
    active_blocker: 'NONE',
    ...overrides,
  };
}

test('SPEC section 14 test 3: capacity 200 against the real CSV with default quotas', () => {
  const vehicles = loadCsvVehicles();
  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: DEFAULT_BRAND_QUOTAS,
    dailyCapacity: 200,
  });

  assert.equal(result.selected.length, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.brandQuotaUtilization).map(([b, u]) => [b, u.selected])),
    { Toyota: 55, Lexus: 36, Geely: 44, GAC: 22, Zeekr: 43 }
  );
  assert.equal(result.brandQuotaUtilization.Geely.overage, 12);
  assert.equal(result.brandQuotaUtilization.Zeekr.overage, 15);
  assert.equal(result.brandQuotaUtilization.Toyota.overage, 0);

  // SPEC section 14 test 4: source distribution for this same selection
  assert.deepEqual(result.sourceLocationCounts, {
    'נמל חיפה': 52,
    'נמל אשדוד': 51,
    'בונדד אשדוד': 49,
    'בונדד חיפה': 48,
  });

  // exclusion-reason breakdown, independently computed from the raw CSV
  const reasonCounts = result.exclusions.reduce((acc, e) => {
    acc[e.reason] = (acc[e.reason] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(reasonCounts, {
    NOT_CUSTOMS_RELEASED: 9,
    ACTIVE_BLOCKER: 29,
    HARD_QUOTA_EXCEEDED: 14,
    OVER_CAPACITY: 48,
  });

  assert.equal(result.selected.length + result.exclusions.length, vehicles.length);
});

test('SPEC section 14 test 5: capacity 195 against the real CSV with default quotas', () => {
  const vehicles = loadCsvVehicles();
  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: DEFAULT_BRAND_QUOTAS,
    dailyCapacity: 195,
  });

  assert.equal(result.selected.length, 195);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.brandQuotaUtilization).map(([b, u]) => [b, u.selected])),
    { Toyota: 55, Lexus: 36, Geely: 42, GAC: 20, Zeekr: 42 }
  );
});

test('FIFO tie-break: same envelope_date selects the lower vehicle_id first', () => {
  const vehicles = [
    fixtureVehicle({ vehicle_id: 'PDI-050', envelope_date: '2026-05-01' }),
    fixtureVehicle({ vehicle_id: 'PDI-010', envelope_date: '2026-05-01' }),
    fixtureVehicle({ vehicle_id: 'PDI-030', envelope_date: '2026-04-01' }),
  ];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Toyota: { target: 100, type: 'FLEX' } },
    dailyCapacity: 100,
  });

  assert.deepEqual(
    result.selected.map((v) => v.vehicle_id),
    ['PDI-030', 'PDI-010', 'PDI-050']
  );
});

test('manually excluded vehicle is never selected and does not consume quota or capacity', () => {
  const vehicles = [
    fixtureVehicle({ vehicle_id: 'PDI-001', envelope_date: '2026-01-01' }),
    fixtureVehicle({ vehicle_id: 'PDI-002', envelope_date: '2026-01-02' }),
  ];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: ['PDI-001'],
    brandQuotas: { Toyota: { target: 100, type: 'FLEX' } },
    dailyCapacity: 1,
  });

  assert.deepEqual(result.selected.map((v) => v.vehicle_id), ['PDI-002']);
  assert.deepEqual(result.exclusions, [{ vehicle_id: 'PDI-001', reason: REASONS.MANUALLY_EXCLUDED }]);
  assert.equal(result.brandQuotaUtilization.Toyota.selected, 1);
});

test('HARD quota of 0 excludes every candidate of that brand, other brands continue to be evaluated', () => {
  const vehicles = [
    fixtureVehicle({ vehicle_id: 'PDI-001', brand: 'Toyota', envelope_date: '2026-01-01' }),
    fixtureVehicle({ vehicle_id: 'PDI-002', brand: 'Lexus', envelope_date: '2026-01-02' }),
    fixtureVehicle({ vehicle_id: 'PDI-003', brand: 'Toyota', envelope_date: '2026-01-03' }),
  ];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Toyota: { target: 0, type: 'HARD' }, Lexus: { target: 10, type: 'HARD' } },
    dailyCapacity: 10,
  });

  assert.deepEqual(result.selected.map((v) => v.vehicle_id), ['PDI-002']);
  assert.deepEqual(result.exclusions, [
    { vehicle_id: 'PDI-001', reason: REASONS.HARD_QUOTA_EXCEEDED },
    { vehicle_id: 'PDI-003', reason: REASONS.HARD_QUOTA_EXCEEDED },
  ]);
  assert.equal(result.brandQuotaUtilization.Toyota.selected, 0);
});

test('HARD quota exhaustion mid-scan: a later brand is skipped-and-continued, not stopped', () => {
  const vehicles = [
    fixtureVehicle({ vehicle_id: 'PDI-001', brand: 'Toyota', envelope_date: '2026-01-01' }),
    fixtureVehicle({ vehicle_id: 'PDI-002', brand: 'Toyota', envelope_date: '2026-01-02' }),
    fixtureVehicle({ vehicle_id: 'PDI-003', brand: 'Toyota', envelope_date: '2026-01-03' }), // exceeds target of 2
    fixtureVehicle({ vehicle_id: 'PDI-004', brand: 'Lexus', envelope_date: '2026-01-04' }), // must still be selected
  ];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Toyota: { target: 2, type: 'HARD' }, Lexus: { target: 10, type: 'HARD' } },
    dailyCapacity: 10,
  });

  assert.deepEqual(result.selected.map((v) => v.vehicle_id), ['PDI-001', 'PDI-002', 'PDI-004']);
  assert.deepEqual(
    result.exclusions.map((e) => e.vehicle_id),
    ['PDI-003']
  );
});

test('FLEX brand has no ceiling other than capacity/eligibility', () => {
  const vehicles = Array.from({ length: 5 }, (_, i) =>
    fixtureVehicle({ vehicle_id: `PDI-${String(i + 1).padStart(3, '0')}`, brand: 'Geely', envelope_date: `2026-01-0${i + 1}` })
  );

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Geely: { target: 2, type: 'FLEX' } },
    dailyCapacity: 10,
  });

  assert.equal(result.selected.length, 5);
  assert.equal(result.brandQuotaUtilization.Geely.selected, 5);
  assert.equal(result.brandQuotaUtilization.Geely.overage, 3);
  assert.equal(result.exclusions.length, 0);
});

test('fewer eligible candidates than capacity: selects the full eligible set without padding or error', () => {
  const vehicles = [
    fixtureVehicle({ vehicle_id: 'PDI-001' }),
    fixtureVehicle({ vehicle_id: 'PDI-002', customs_released: false }),
    fixtureVehicle({ vehicle_id: 'PDI-003', active_blocker: 'RECALL' }),
  ];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Toyota: { target: 100, type: 'FLEX' } },
    dailyCapacity: 200,
  });

  assert.deepEqual(result.selected.map((v) => v.vehicle_id), ['PDI-001']);
  assert.equal(result.exclusions.length, 2);
});

test('dailyCapacity of 0 selects nothing (regression: capacity-reached flag used to apply one vehicle late)', () => {
  const vehicles = [fixtureVehicle({ vehicle_id: 'PDI-001' })];

  const result = generateRecommendation({
    vehicles,
    excludedVehicleIds: [],
    brandQuotas: { Toyota: { target: 100, type: 'FLEX' } },
    dailyCapacity: 0,
  });

  assert.equal(result.selected.length, 0);
  assert.deepEqual(result.exclusions, [{ vehicle_id: 'PDI-001', reason: REASONS.OVER_CAPACITY }]);
});

test('selection is independent of display-only fields and does not use shipping capacity at all', () => {
  const base = [
    fixtureVehicle({ vehicle_id: 'PDI-001', envelope_date: '2026-01-01', customer_segment: 'GENERAL', population: 'CUSTOMER', requested_delivery_date: '2026-01-05' }),
    fixtureVehicle({ vehicle_id: 'PDI-002', envelope_date: '2026-01-02', customer_segment: 'SECURITY_FORCES', population: 'FLEET', requested_delivery_date: '2020-01-01' }),
  ];
  const quotas = { Toyota: { target: 100, type: 'FLEX' } };

  const resultA = generateRecommendation({ vehicles: base, excludedVehicleIds: [], brandQuotas: quotas, dailyCapacity: 10 });

  const swapped = base.map((v) => ({
    ...v,
    customer_segment: v.customer_segment === 'GENERAL' ? 'SECURITY_FORCES' : 'GENERAL',
    population: v.population === 'CUSTOMER' ? 'MOBILITY' : 'CUSTOMER',
    requested_delivery_date: '1999-01-01',
  }));
  const resultB = generateRecommendation({ vehicles: swapped, excludedVehicleIds: [], brandQuotas: quotas, dailyCapacity: 10 });

  assert.deepEqual(
    resultA.selected.map((v) => v.vehicle_id),
    resultB.selected.map((v) => v.vehicle_id)
  );

  // the module's exported function signature has no shipping-capacity parameter at all
  assert.equal(generateRecommendation.length, 1);
});
