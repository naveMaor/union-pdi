'use strict';

module.exports = (sequelize, DataTypes) => {
  const PlanVehicle = sequelize.define(
    'PlanVehicle',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      plan_id: { type: DataTypes.BIGINT, allowNull: false },
      vehicle_id: { type: DataTypes.STRING(10), allowNull: false },
      source: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [['ALGORITHM', 'MANUAL']] },
      },
      added_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'plan_vehicles',
      underscored: true,
      createdAt: false,
      updatedAt: false,
      indexes: [{ unique: true, fields: ['plan_id', 'vehicle_id'] }],
    }
  );

  PlanVehicle.associate = (models) => {
    PlanVehicle.belongsTo(models.Plan, { foreignKey: 'plan_id' });
    PlanVehicle.belongsTo(models.Vehicle, { foreignKey: 'vehicle_id' });
  };

  return PlanVehicle;
};
