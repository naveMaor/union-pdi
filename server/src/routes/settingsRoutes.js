'use strict';

const settingsService = require('../services/settingsService');
const { demoRoleHook } = require('./demoRoleHook');

// Separate plugin/file from planRoutes.js: settings is a distinct resource
// (admin parameters, SPEC §5.3) from the plan/vehicle screens, owned entirely
// by the ADMIN role — keeping it apart avoids mixing an unrelated resource
// into the already-sizable plan routes file.
async function settingsRoutes(fastify) {
  fastify.addHook('preHandler', demoRoleHook);

  fastify.get('/settings', async () => {
    // Open to any valid demo role (PLANNER/SHIPPING/ADMIN) — see getSettings' doc comment.
    return settingsService.getSettings();
  });

  fastify.put('/settings', async (request) => {
    const { actor } = request;
    const { dailyCapacity, envelopeYellowThresholdDays, envelopeRedThresholdDays, brandQuotas, shippingCapacities } =
      request.body || {};
    return settingsService.updateSettings({
      actorName: actor.name,
      actorRole: actor.role,
      dailyCapacity,
      envelopeYellowThresholdDays,
      envelopeRedThresholdDays,
      brandQuotas,
      shippingCapacities,
    });
  });
}

module.exports = settingsRoutes;
