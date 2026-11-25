'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('audit_events', {
      id: { type: Sequelize.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      plan_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: { model: 'plans', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      vehicle_id: {
        type: Sequelize.STRING(10),
        allowNull: true,
        references: { model: 'vehicles', key: 'vehicle_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      event_type: { type: Sequelize.STRING(40), allowNull: false },
      actor_name: { type: Sequelize.STRING, allowNull: false },
      actor_role: { type: Sequelize.STRING(10), allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('audit_events', {
      fields: ['event_type'],
      type: 'check',
      name: 'audit_events_event_type_check',
      where: {
        event_type: [
          'RECOMMENDATION_RUN',
          'STATUS_TRANSITION',
          'MANUAL_EXCLUSION',
          'EXCLUSION_CANCELLED',
          'MANUAL_ADDITION',
          'BLOCKER_ADDED',
          'BLOCKER_REMOVED',
          'SETTINGS_CHANGED',
          'SHIPPING_APPROVED',
          'SHIPPING_RETURNED',
        ],
      },
    });
    await queryInterface.addConstraint('audit_events', {
      fields: ['actor_role'],
      type: 'check',
      name: 'audit_events_actor_role_check',
      where: { actor_role: ['PLANNER', 'SHIPPING', 'ADMIN'] },
    });

    await queryInterface.addIndex('audit_events', ['plan_id']);
    await queryInterface.addIndex('audit_events', ['vehicle_id']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('audit_events');
  },
};
