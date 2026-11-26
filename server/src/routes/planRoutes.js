'use strict';

const planService = require('../services/planService');
const planEditService = require('../services/planEditService');
const blockerService = require('../services/blockerService');
const planReadService = require('../services/planReadService');
const { demoRoleHook } = require('./demoRoleHook');

async function planRoutes(fastify) {
  fastify.addHook('preHandler', demoRoleHook);

  fastify.post('/plan/generate', async (request, reply) => {
    const { actor } = request;

    try {
      return await planService.generatePlan({ actorName: actor.name, actorRole: actor.role, confirm: request.body?.confirm });
    } catch (error) {
      if (error.code !== 'CONFIRMATION_REQUIRED') throw error;
      return reply.code(409).send({
        error: error.code,
        message: error.message,
        plan: { status: error.planStatus },
      });
    }
  });

  fastify.get('/plan', async () => {
    return planReadService.getPlanSummary();
  });

  fastify.get('/vehicles', async (request) => {
    const { tab, search, brand, sourceLocation, sortByEnvelopeDate } = request.query;
    return planReadService.listVehicles({
      tab,
      search,
      brand,
      sourceLocation,
      sortByEnvelopeDate: sortByEnvelopeDate === 'true' || sortByEnvelopeDate === true,
    });
  });

  fastify.post('/plan/vehicles/:vehicleId/exclude', async (request) => {
    const { actor } = request;
    const { vehicleId } = request.params;
    const { reasonCode, note } = request.body || {};
    return planEditService.excludeVehicle({
      actorName: actor.name,
      actorRole: actor.role,
      vehicleId,
      reasonCode,
      note,
    });
  });

  fastify.post('/plan/vehicles/:vehicleId/cancel-exclusion', async (request) => {
    const { actor } = request;
    const { vehicleId } = request.params;
    return planEditService.cancelExclusion({ actorName: actor.name, actorRole: actor.role, vehicleId });
  });

  fastify.get('/plan/replacement', async (request) => {
    const { actor } = request;
    return planEditService.getReplacementSuggestion({ actorRole: actor.role });
  });

  fastify.post('/plan/replacement/confirm', async (request) => {
    const { actor } = request;
    const { vehicleId } = request.body || {};
    return planEditService.confirmReplacement({ actorName: actor.name, actorRole: actor.role, vehicleId });
  });

  fastify.post('/vehicles/:vehicleId/blocker', async (request) => {
    const { actor } = request;
    const { vehicleId } = request.params;
    const { blockerCode } = request.body || {};
    return blockerService.addBlocker({ actorName: actor.name, actorRole: actor.role, vehicleId, blockerCode });
  });

  fastify.delete('/vehicles/:vehicleId/blocker', async (request) => {
    const { actor } = request;
    const { vehicleId } = request.params;
    return blockerService.removeBlocker({ actorName: actor.name, actorRole: actor.role, vehicleId });
  });

  fastify.post('/plan/submit', async (request) => {
    const { actor } = request;
    return planService.submitForShipping({ actorName: actor.name, actorRole: actor.role });
  });

  fastify.post('/plan/approve', async (request) => {
    const { actor } = request;
    return planService.approveForShipping({ actorName: actor.name, actorRole: actor.role });
  });

  fastify.post('/plan/return', async (request) => {
    const { actor } = request;
    const { comment } = request.body || {};
    return planService.returnToPlanner({ actorName: actor.name, actorRole: actor.role, comment });
  });
}

module.exports = planRoutes;
