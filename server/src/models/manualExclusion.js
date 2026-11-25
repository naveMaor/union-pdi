'use strict';

module.exports = (sequelize, DataTypes) => {
  const ManualExclusion = sequelize.define(
    'ManualExclusion',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      plan_id: { type: DataTypes.BIGINT, allowNull: false },
      vehicle_id: { type: DataTypes.STRING(10), allowNull: false },
      reason_code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: {
          isIn: [
            [
              'PRIORITIZED_OTHER',
              'SECURITY_FORCES',
              'OPERATIONAL_DELAY',
              'ACCESSORY_ISSUE',
              'AUTHORITY_INSTRUCTION',
              'OTHER',
            ],
          ],
        },
      },
      note: { type: DataTypes.TEXT, allowNull: true },
      excluded_by_name: { type: DataTypes.STRING, allowNull: false },
      excluded_by_role: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [['PLANNER', 'SHIPPING', 'ADMIN']] },
      },
      excluded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      cancelled_by_name: { type: DataTypes.STRING, allowNull: true },
      cancelled_by_role: {
        type: DataTypes.STRING(10),
        allowNull: true,
        validate: { isIn: [['PLANNER', 'SHIPPING', 'ADMIN']] },
      },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'manual_exclusions',
      underscored: true,
      createdAt: false,
      updatedAt: false,
    }
  );

  ManualExclusion.associate = (models) => {
    ManualExclusion.belongsTo(models.Plan, { foreignKey: 'plan_id' });
    ManualExclusion.belongsTo(models.Vehicle, { foreignKey: 'vehicle_id' });
  };

  return ManualExclusion;
};
