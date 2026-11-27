'use strict';

const EXISTING_EVENT_TYPES = [
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
];

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.removeConstraint('audit_events', 'audit_events_event_type_check');
    await queryInterface.addConstraint('audit_events', {
      fields: ['event_type'],
      type: 'check',
      name: 'audit_events_event_type_check',
      where: { event_type: [...EXISTING_EVENT_TYPES, 'DEMO_RESET'] },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeConstraint('audit_events', 'audit_events_event_type_check');
    await queryInterface.addConstraint('audit_events', {
      fields: ['event_type'],
      type: 'check',
      name: 'audit_events_event_type_check',
      where: { event_type: EXISTING_EVENT_TYPES },
    });
  },
};
