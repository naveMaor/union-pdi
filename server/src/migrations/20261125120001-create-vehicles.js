'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('vehicles', {
      vehicle_id: { type: Sequelize.STRING(10), primaryKey: true, allowNull: false },
      demo_vin: { type: Sequelize.STRING, allowNull: false },
      brand: {
        type: Sequelize.STRING(20),
        allowNull: false,
        validate: { isIn: [['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr']] },
      },
      model: { type: Sequelize.STRING, allowNull: false },
      source_location: { type: Sequelize.STRING(20), allowNull: false },
      population: { type: Sequelize.STRING(20), allowNull: false },
      customer_segment: { type: Sequelize.STRING(20), allowNull: false },
      envelope_date: { type: Sequelize.DATEONLY, allowNull: false },
      requested_delivery_date: { type: Sequelize.DATEONLY, allowNull: false },
      customs_released: { type: Sequelize.BOOLEAN, allowNull: false },
      active_blocker: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'NONE' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('vehicles', {
      fields: ['brand'],
      type: 'check',
      name: 'vehicles_brand_check',
      where: { brand: ['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr'] },
    });
    await queryInterface.addConstraint('vehicles', {
      fields: ['source_location'],
      type: 'check',
      name: 'vehicles_source_location_check',
      where: { source_location: ['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה'] },
    });
    await queryInterface.addConstraint('vehicles', {
      fields: ['population'],
      type: 'check',
      name: 'vehicles_population_check',
      where: { population: ['CUSTOMER', 'FLEET', 'MOBILITY'] },
    });
    await queryInterface.addConstraint('vehicles', {
      fields: ['customer_segment'],
      type: 'check',
      name: 'vehicles_customer_segment_check',
      where: { customer_segment: ['GENERAL', 'SECURITY_FORCES'] },
    });
    await queryInterface.addConstraint('vehicles', {
      fields: ['active_blocker'],
      type: 'check',
      name: 'vehicles_active_blocker_check',
      where: { active_blocker: ['NONE', 'RECALL', 'WORK_STOP', 'MISSING_ACCESSORY', 'DAMAGE', 'ZERO_KM_STOP'] },
    });

    await queryInterface.addIndex('vehicles', ['envelope_date', 'vehicle_id'], {
      name: 'vehicles_envelope_date_vehicle_id_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('vehicles');
  },
};
