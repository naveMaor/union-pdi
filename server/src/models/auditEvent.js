'use strict';

module.exports = (sequelize, DataTypes) => {
  const AuditEvent = sequelize.define(
    'AuditEvent',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      plan_id: { type: DataTypes.BIGINT, allowNull: true },
      vehicle_id: { type: DataTypes.STRING(10), allowNull: true },
      event_type: {
        type: DataTypes.STRING(40),
        allowNull: false,
        validate: {
          isIn: [
            [
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
          ],
        },
      },
      actor_name: { type: DataTypes.STRING, allowNull: false },
      actor_role: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [['PLANNER', 'SHIPPING', 'ADMIN']] },
      },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: 'audit_events',
      underscored: true,
      updatedAt: false,
    }
  );

  AuditEvent.associate = (models) => {
    AuditEvent.belongsTo(models.Plan, { foreignKey: 'plan_id' });
    AuditEvent.belongsTo(models.Vehicle, { foreignKey: 'vehicle_id' });
  };

  return AuditEvent;
};
