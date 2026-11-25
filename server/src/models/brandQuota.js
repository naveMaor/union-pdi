'use strict';

module.exports = (sequelize, DataTypes) => {
  const BrandQuota = sequelize.define(
    'BrandQuota',
    {
      brand: {
        type: DataTypes.STRING(20),
        primaryKey: true,
        validate: { isIn: [['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr']] },
      },
      quota_target: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0 } },
      quota_type: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [['HARD', 'FLEX']] },
      },
    },
    {
      tableName: 'brand_quotas',
      underscored: true,
      createdAt: false,
    }
  );

  return BrandQuota;
};
