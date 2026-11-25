'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('plan_vehicles', {
      id: { type: Sequelize.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      plan_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      vehicle_id: {
        type: Sequelize.STRING(10),
        allowNull: false,
        references: { model: 'vehicles', key: 'vehicle_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      source: { type: Sequelize.STRING(10), allowNull: false },
      added_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('plan_vehicles', {
      fields: ['source'],
      type: 'check',
      name: 'plan_vehicles_source_check',
      where: { source: ['ALGORITHM', 'MANUAL'] },
    });
    await queryInterface.addConstraint('plan_vehicles', {
      fields: ['plan_id', 'vehicle_id'],
      type: 'unique',
      name: 'plan_vehicles_plan_id_vehicle_id_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('plan_vehicles');
  },
};
