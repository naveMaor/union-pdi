'use strict';

module.exports = (sequelize, DataTypes) => {
  const Plan = sequelize.define(
    'Plan',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      plan_date: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'DRAFT',
        validate: { isIn: [['DRAFT', 'PENDING_SHIPPING', 'APPROVED', 'RETURNED']] },
      },
      returned_note: { type: DataTypes.TEXT, allowNull: true },
      capacity_snapshot: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
      brand_quotas_snapshot: { type: DataTypes.JSONB, allowNull: false },
      last_recommendation_run_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'plans',
      underscored: true,
    }
  );

  Plan.associate = (models) => {
    Plan.hasMany(models.PlanVehicle, { foreignKey: 'plan_id' });
    Plan.hasMany(models.ManualExclusion, { foreignKey: 'plan_id' });
    Plan.hasMany(models.AuditEvent, { foreignKey: 'plan_id' });
  };

  return Plan;
};
