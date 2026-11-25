'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('brand_quotas', {
      brand: { type: Sequelize.STRING(20), primaryKey: true, allowNull: false },
      quota_target: { type: Sequelize.INTEGER, allowNull: false },
      quota_type: { type: Sequelize.STRING(10), allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('brand_quotas', {
      fields: ['brand'],
      type: 'check',
      name: 'brand_quotas_brand_check',
      where: { brand: ['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr'] },
    });
    await queryInterface.addConstraint('brand_quotas', {
      fields: ['quota_target'],
      type: 'check',
      name: 'brand_quotas_quota_target_check',
      where: { quota_target: { [Sequelize.Op.gte]: 0 } },
    });
    await queryInterface.addConstraint('brand_quotas', {
      fields: ['quota_type'],
      type: 'check',
      name: 'brand_quotas_quota_type_check',
      where: { quota_type: ['HARD', 'FLEX'] },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('brand_quotas');
  },
};
