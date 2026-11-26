'use strict';

const planService = require('../services/planService');
const planEditService = require('../services/planEditService');
const blockerService = require('../services/blockerService');
const planReadService = require('../services/planReadService');

// Fixed demo users (SPEC §4) — role simulation only, not authentication. The
// server resolves the actor NAME from the role code itself; a client can never
// supply its own name.
const DEMO_USERS = {
  PLANNER: 'מיכל לוי',
  SHIPPING: 'יוסי כהן',
  ADMIN: 'רונית שמש',
};

async function planRoutes(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    const role = request.headers['x-demo-role'];
    if (!role || !DEMO_USERS[role]) {
      reply.code(400).send({
        error: 'INVALID_DEMO_ROLE',
        message: 'x-demo-role header must be one of PLANNER, SHIPPING, ADMIN',
      });
      return reply;
    }
    request.actor = { role, name: DEMO_USERS[role] };
  });

  fastify.post('/plan/generate', async (request, reply) => {
    const { actor } = request;
    const confirm = request.body && request.body.confirm === true;

    const existingPlan = await planService.getCurrentPlan();
    if (existingPlan && !confirm) {
      return reply.code(409).send({
        error: 'CONFIRMATION_REQUIRED',
        message: 'A plan already exists for this date. Resend with { "confirm": true } to regenerate it.',
        plan: { status: existingPlan.status },
      });
    }

    const result = await planService.generatePlan({ actorName: actor.name, actorRole: actor.role });
    return result;
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
}

module.exports = planRoutes;
