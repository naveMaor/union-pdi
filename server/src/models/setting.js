'use strict';

module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define(
    'Setting',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
      daily_capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 200, validate: { min: 1 } },
      envelope_yellow_threshold_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 9, validate: { min: 0 } },
      envelope_red_threshold_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 14, validate: { min: 0 } },
    },
    {
      tableName: 'settings',
      underscored: true,
      createdAt: false,
    }
  );

  return Setting;
};
