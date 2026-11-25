'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('settings', {
      id: { type: Sequelize.INTEGER, primaryKey: true, allowNull: false, defaultValue: 1 },
      daily_capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 200 },
      envelope_yellow_threshold_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 9 },
      envelope_red_threshold_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 14 },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE settings ADD CONSTRAINT settings_single_row_check CHECK (id = 1)'
    );
    await queryInterface.addConstraint('settings', {
      fields: ['daily_capacity'],
      type: 'check',
      name: 'settings_daily_capacity_check',
      where: { daily_capacity: { [Sequelize.Op.gte]: 1 } },
    });
    await queryInterface.addConstraint('settings', {
      fields: ['envelope_yellow_threshold_days'],
      type: 'check',
      name: 'settings_envelope_yellow_threshold_days_check',
      where: { envelope_yellow_threshold_days: { [Sequelize.Op.gte]: 0 } },
    });
    await queryInterface.addConstraint('settings', {
      fields: ['envelope_red_threshold_days'],
      type: 'check',
      name: 'settings_envelope_red_threshold_days_check',
      where: { envelope_red_threshold_days: { [Sequelize.Op.gte]: 0 } },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('settings');
  },
};
