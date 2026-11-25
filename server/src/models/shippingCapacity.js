'use strict';

module.exports = (sequelize, DataTypes) => {
  const ShippingCapacity = sequelize.define(
    'ShippingCapacity',
    {
      source_location: {
        type: DataTypes.STRING(20),
        primaryKey: true,
        validate: { isIn: [['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה']] },
      },
      capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 65, validate: { min: 0 } },
    },
    {
      tableName: 'shipping_capacities',
      underscored: true,
      createdAt: false,
    }
  );

  return ShippingCapacity;
};
