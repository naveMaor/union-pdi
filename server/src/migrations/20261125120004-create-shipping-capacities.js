'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('shipping_capacities', {
      source_location: { type: Sequelize.STRING(20), primaryKey: true, allowNull: false },
      capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 65 },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('shipping_capacities', {
      fields: ['source_location'],
      type: 'check',
      name: 'shipping_capacities_source_location_check',
      where: { source_location: ['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה'] },
    });
    await queryInterface.addConstraint('shipping_capacities', {
      fields: ['capacity'],
      type: 'check',
      name: 'shipping_capacities_capacity_check',
      where: { capacity: { [Sequelize.Op.gte]: 0 } },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('shipping_capacities');
  },
};
