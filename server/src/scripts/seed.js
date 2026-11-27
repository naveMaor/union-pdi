'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../models');

const CSV_PATH = path.resolve(__dirname, '..', '..', '..', 'docs', 'assignment', 'pdi_seed_300_vehicles.csv');

const DEFAULT_SETTINGS = {
  id: 1,
  daily_capacity: 200,
  envelope_yellow_threshold_days: 9,
  envelope_red_threshold_days: 14,
};

const DEFAULT_BRAND_QUOTAS = [
  { brand: 'Toyota', quota_target: 55, quota_type: 'HARD' },
  { brand: 'Lexus', quota_target: 36, quota_type: 'HARD' },
  { brand: 'Geely', quota_target: 32, quota_type: 'FLEX' },
  { brand: 'GAC', quota_target: 22, quota_type: 'HARD' },
  { brand: 'Zeekr', quota_target: 28, quota_type: 'FLEX' },
];

const DEFAULT_SHIPPING_CAPACITIES = [
  { source_location: 'נמל אשדוד', capacity: 65 },
  { source_location: 'נמל חיפה', capacity: 65 },
  { source_location: 'בונדד אשדוד', capacity: 65 },
  { source_location: 'בונדד חיפה', capacity: 65 },
];

function parseVehiclesCsv(csvPath) {
  let text = fs.readFileSync(csvPath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM

  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  const header = lines[0].split(',');

  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((col, i) => {
      row[col] = cells[i];
    });

    return {
      vehicle_id: row.vehicle_id,
      demo_vin: row.demo_vin,
      brand: row.brand,
      model: row.model,
      source_location: row.source_location,
      population: row.population,
      customer_segment: row.customer_segment,
      envelope_date: row.envelope_date,
      requested_delivery_date: row.requested_delivery_date,
      customs_released: row.customs_released.trim().toLowerCase() === 'true',
      active_blocker: row.active_blocker,
    };
  });
}

async function seedVehicles() {
  const vehicles = parseVehiclesCsv(CSV_PATH);

  return db.sequelize.transaction(async (transaction) => {
    // ignoreDuplicates -> INSERT ... ON CONFLICT DO NOTHING: new vehicles are
    // added, but rows already present (including any active_blocker changes
    // made later through the app) are left untouched.
    await db.Vehicle.bulkCreate(vehicles, { ignoreDuplicates: true, transaction });
  });
}

async function seedDefaults() {
  return db.sequelize.transaction(async (transaction) => {
    await db.Setting.findOrCreate({
      where: { id: 1 },
      defaults: DEFAULT_SETTINGS,
      transaction,
    });

    for (const quota of DEFAULT_BRAND_QUOTAS) {
      await db.BrandQuota.findOrCreate({
        where: { brand: quota.brand },
        defaults: quota,
        transaction,
      });
    }

    for (const capacity of DEFAULT_SHIPPING_CAPACITIES) {
      await db.ShippingCapacity.findOrCreate({
        where: { source_location: capacity.source_location },
        defaults: capacity,
        transaction,
      });
    }
  });
}

async function run() {
  await seedVehicles();
  await seedDefaults();

  const vehicleCount = await db.Vehicle.count();
  console.log(`Seed complete. vehicles=${vehicleCount}`);
}

if (require.main === module) {
  run()
    .then(() => db.sequelize.close())
    .catch((error) => {
      console.error(error);
      return db.sequelize.close().finally(() => process.exit(1));
    });
}

module.exports = {
  run,
  parseVehiclesCsv,
  seedVehicles,
  seedDefaults,
  CSV_PATH,
  DEFAULT_SETTINGS,
  DEFAULT_BRAND_QUOTAS,
  DEFAULT_SHIPPING_CAPACITIES,
};
