'use strict';

const db = require('../models');
const { PlanServiceError, assertAdminRole } = require('./planService');

const BRANDS = ['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr'];
const SOURCE_LOCATIONS = ['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה'];
const QUOTA_TYPES = ['HARD', 'FLEX'];

function isInteger(value, min) {
  return Number.isInteger(value) && value >= min;
}

/**
 * Reads all admin-configurable parameters (SPEC §5.3). Open to any valid demo
 * role, not just ADMIN — the planner screen needs the envelope-day thresholds
 * (SPEC §5.1's yellow/red coloring) and the shipping screen needs shipping
 * capacities (SPEC §5.2's over-capacity indicator) to render their own
 * displays. Only *writing* settings is ADMIN-only (see updateSettings).
 */
async function getSettings({ transaction } = {}) {

  // Sequential, not Promise.all/array-of-promises: when called with a
  // transaction, these share one connection, and pg does not support
  // concurrent queries on the same client.
  const settings = await db.Setting.findByPk(1, { transaction });
  const brandQuotaRows = await db.BrandQuota.findAll({ transaction, raw: true });
  const shippingCapacityRows = await db.ShippingCapacity.findAll({ transaction, raw: true });

  const brandQuotas = {};
  for (const row of brandQuotaRows) {
    brandQuotas[row.brand] = { quota_target: row.quota_target, quota_type: row.quota_type };
  }

  const shippingCapacities = {};
  for (const row of shippingCapacityRows) {
    shippingCapacities[row.source_location] = row.capacity;
  }

  return {
    dailyCapacity: settings.daily_capacity,
    envelopeYellowThresholdDays: settings.envelope_yellow_threshold_days,
    envelopeRedThresholdDays: settings.envelope_red_threshold_days,
    brandQuotas,
    shippingCapacities,
  };
}

/**
 * Updates admin-configurable parameters (SPEC §5.3). ADMIN role only. Every
 * field is optional (partial update); whatever is provided is validated
 * strictly server-side before anything is written. Never touches Plan,
 * PlanVehicle or any snapshot row — existing plans are unaffected (SPEC §5.3's
 * "a parameter change does not change an existing plan"); the next
 * generatePlan() run picks up the new values by construction, since it already
 * reads these tables live.
 *
 * @param {object} params
 * @param {string} params.actorName
 * @param {string} params.actorRole - must be 'ADMIN'
 * @param {number} [params.dailyCapacity]
 * @param {number} [params.envelopeYellowThresholdDays]
 * @param {number} [params.envelopeRedThresholdDays]
 * @param {Object.<string, {quota_target: number, quota_type: 'HARD'|'FLEX'}>} [params.brandQuotas]
 * @param {Object.<string, number>} [params.shippingCapacities]
 */
async function updateSettings({
  actorName,
  actorRole,
  dailyCapacity,
  envelopeYellowThresholdDays,
  envelopeRedThresholdDays,
  brandQuotas,
  shippingCapacities,
}) {
  assertAdminRole(actorRole);

  if (dailyCapacity !== undefined && !isInteger(dailyCapacity, 1)) {
    throw new PlanServiceError('INVALID_SETTING_VALUE', 'dailyCapacity must be an integer >= 1');
  }
  if (envelopeYellowThresholdDays !== undefined && !isInteger(envelopeYellowThresholdDays, 0)) {
    throw new PlanServiceError('INVALID_SETTING_VALUE', 'envelopeYellowThresholdDays must be an integer >= 0');
  }
  if (envelopeRedThresholdDays !== undefined && !isInteger(envelopeRedThresholdDays, 0)) {
    throw new PlanServiceError('INVALID_SETTING_VALUE', 'envelopeRedThresholdDays must be an integer >= 0');
  }
  if (brandQuotas !== undefined) {
    for (const [brand, quota] of Object.entries(brandQuotas)) {
      if (!BRANDS.includes(brand)) {
        throw new PlanServiceError('INVALID_SETTING_VALUE', `${brand} is not a known brand`);
      }
      if (!quota || !isInteger(quota.quota_target, 0)) {
        throw new PlanServiceError('INVALID_SETTING_VALUE', `${brand} quota_target must be an integer >= 0`);
      }
      if (!QUOTA_TYPES.includes(quota.quota_type)) {
        throw new PlanServiceError('INVALID_SETTING_VALUE', `${brand} quota_type must be HARD or FLEX`);
      }
    }
  }
  if (shippingCapacities !== undefined) {
    for (const [sourceLocation, capacity] of Object.entries(shippingCapacities)) {
      if (!SOURCE_LOCATIONS.includes(sourceLocation)) {
        throw new PlanServiceError('INVALID_SETTING_VALUE', `${sourceLocation} is not a known source location`);
      }
      if (!isInteger(capacity, 0)) {
        throw new PlanServiceError('INVALID_SETTING_VALUE', `${sourceLocation} capacity must be an integer >= 0`);
      }
    }
  }

  return db.sequelize.transaction(async (transaction) => {
    const changes = [];

    if (dailyCapacity !== undefined || envelopeYellowThresholdDays !== undefined || envelopeRedThresholdDays !== undefined) {
      const settings = await db.Setting.findByPk(1, { transaction });
      const before = {
        daily_capacity: settings.daily_capacity,
        envelope_yellow_threshold_days: settings.envelope_yellow_threshold_days,
        envelope_red_threshold_days: settings.envelope_red_threshold_days,
      };
      const update = {};
      if (dailyCapacity !== undefined) update.daily_capacity = dailyCapacity;
      if (envelopeYellowThresholdDays !== undefined) update.envelope_yellow_threshold_days = envelopeYellowThresholdDays;
      if (envelopeRedThresholdDays !== undefined) update.envelope_red_threshold_days = envelopeRedThresholdDays;
      await settings.update(update, { transaction });
      changes.push({ setting: 'daily_capacity_and_thresholds', before, after: update });
    }

    if (brandQuotas !== undefined) {
      for (const [brand, quota] of Object.entries(brandQuotas)) {
        const row = await db.BrandQuota.findByPk(brand, { transaction });
        const before = { quota_target: row.quota_target, quota_type: row.quota_type };
        await row.update({ quota_target: quota.quota_target, quota_type: quota.quota_type }, { transaction });
        changes.push({ setting: `brand_quota:${brand}`, before, after: quota });
      }
    }

    if (shippingCapacities !== undefined) {
      for (const [sourceLocation, capacity] of Object.entries(shippingCapacities)) {
        const row = await db.ShippingCapacity.findByPk(sourceLocation, { transaction });
        const before = { capacity: row.capacity };
        await row.update({ capacity }, { transaction });
        changes.push({ setting: `shipping_capacity:${sourceLocation}`, before, after: { capacity } });
      }
    }

    if (changes.length > 0) {
      await db.AuditEvent.create(
        {
          plan_id: null,
          vehicle_id: null,
          event_type: 'SETTINGS_CHANGED',
          actor_name: actorName,
          actor_role: actorRole,
          payload: { changes },
        },
        { transaction }
      );
    }

    return getSettings({ transaction });
  });
}

module.exports = { getSettings, updateSettings, BRANDS, SOURCE_LOCATIONS, QUOTA_TYPES };
