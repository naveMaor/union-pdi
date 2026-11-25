'use strict';

module.exports = (sequelize, DataTypes) => {
  const Vehicle = sequelize.define(
    'Vehicle',
    {
      vehicle_id: { type: DataTypes.STRING(10), primaryKey: true },
      demo_vin: { type: DataTypes.STRING, allowNull: false },
      brand: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr']] },
      },
      model: { type: DataTypes.STRING, allowNull: false },
      source_location: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה']] },
      },
      population: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['CUSTOMER', 'FLEET', 'MOBILITY']] },
      },
      customer_segment: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['GENERAL', 'SECURITY_FORCES']] },
      },
      envelope_date: { type: DataTypes.DATEONLY, allowNull: false },
      requested_delivery_date: { type: DataTypes.DATEONLY, allowNull: false },
      customs_released: { type: DataTypes.BOOLEAN, allowNull: false },
      active_blocker: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'NONE',
        validate: {
          isIn: [['NONE', 'RECALL', 'WORK_STOP', 'MISSING_ACCESSORY', 'DAMAGE', 'ZERO_KM_STOP']],
        },
      },
    },
    {
      tableName: 'vehicles',
      underscored: true,
    }
  );

  Vehicle.associate = (models) => {
    Vehicle.hasMany(models.PlanVehicle, { foreignKey: 'vehicle_id' });
    Vehicle.hasMany(models.ManualExclusion, { foreignKey: 'vehicle_id' });
    Vehicle.hasMany(models.AuditEvent, { foreignKey: 'vehicle_id' });
  };

  return Vehicle;
};
