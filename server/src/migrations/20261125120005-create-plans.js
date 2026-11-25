'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('plans', {
      id: { type: Sequelize.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      plan_date: { type: Sequelize.DATEONLY, allowNull: false, unique: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'DRAFT' },
      returned_note: { type: Sequelize.TEXT, allowNull: true },
      capacity_snapshot: { type: Sequelize.INTEGER, allowNull: false },
      brand_quotas_snapshot: { type: Sequelize.JSONB, allowNull: false },
      last_recommendation_run_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('plans', {
      fields: ['status'],
      type: 'check',
      name: 'plans_status_check',
      where: { status: ['DRAFT', 'PENDING_SHIPPING', 'APPROVED', 'RETURNED'] },
    });
    await queryInterface.addConstraint('plans', {
      fields: ['capacity_snapshot'],
      type: 'check',
      name: 'plans_capacity_snapshot_check',
      where: { capacity_snapshot: { [Sequelize.Op.gte]: 1 } },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('plans');
  },
};
