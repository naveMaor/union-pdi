'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('manual_exclusions', {
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
      reason_code: { type: Sequelize.STRING(30), allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      excluded_by_name: { type: Sequelize.STRING, allowNull: false },
      excluded_by_role: { type: Sequelize.STRING(10), allowNull: false },
      excluded_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      cancelled_by_name: { type: Sequelize.STRING, allowNull: true },
      cancelled_by_role: { type: Sequelize.STRING(10), allowNull: true },
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addConstraint('manual_exclusions', {
      fields: ['reason_code'],
      type: 'check',
      name: 'manual_exclusions_reason_code_check',
      where: {
        reason_code: [
          'PRIORITIZED_OTHER',
          'SECURITY_FORCES',
          'OPERATIONAL_DELAY',
          'ACCESSORY_ISSUE',
          'AUTHORITY_INSTRUCTION',
          'OTHER',
        ],
      },
    });
    await queryInterface.addConstraint('manual_exclusions', {
      fields: ['excluded_by_role'],
      type: 'check',
      name: 'manual_exclusions_excluded_by_role_check',
      where: { excluded_by_role: ['PLANNER', 'SHIPPING', 'ADMIN'] },
    });
    await queryInterface.sequelize.query(
      "ALTER TABLE manual_exclusions ADD CONSTRAINT manual_exclusions_cancelled_by_role_check " +
        "CHECK (cancelled_by_role IS NULL OR cancelled_by_role IN ('PLANNER', 'SHIPPING', 'ADMIN'))"
    );

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX manual_exclusions_active_plan_vehicle_idx ON manual_exclusions (plan_id, vehicle_id) WHERE cancelled_at IS NULL'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS manual_exclusions_active_plan_vehicle_idx');
    await queryInterface.dropTable('manual_exclusions');
  },
};
