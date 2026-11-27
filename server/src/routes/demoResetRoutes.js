'use strict';

const crypto = require('crypto');
const demoResetService = require('../services/demoResetService');
const { demoRoleHook } = require('./demoRoleHook');

const MIN_RESET_INTERVAL_MS = 60_000; // at most one successful reset per minute
const MAX_FAILED_TOKEN_ATTEMPTS = 5;
const FAILED_ATTEMPT_WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

// Constant-time token comparison that never short-circuits on length, so a
// wrong-length guess takes the same time as a wrong-content one of the
// correct length.
function tokenMatches(expected, supplied) {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const suppliedBuf = Buffer.from(typeof supplied === 'string' ? supplied : '', 'utf8');
  if (suppliedBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, suppliedBuf);
}

// Demo-only, off-by-default admin feature (see docs/AI_LOG.md and README.md):
// restores the database to its original seed state. Not registered at all
// unless explicitly enabled — see the early return below.
async function demoResetRoutes(fastify) {
  if (process.env.DEMO_RESET_ENABLED !== 'true') return;

  const token = process.env.DEMO_RESET_TOKEN;
  if (!token || token.length < 8) {
    // Fail closed: refuse to start with a missing token rather than
    // register an unprotected endpoint. Minimum lowered from 32 to 8
    // characters at explicit human request for this recruiter-assignment
    // deployment (not a recommended production value).
    throw new Error(
      'DEMO_RESET_TOKEN must be set to a string of at least 8 characters when DEMO_RESET_ENABLED=true'
    );
  }

  fastify.addHook('preHandler', demoRoleHook);

  let lastSuccessfulResetAt = 0;
  let failedAttempts = 0;
  let firstFailureAt = 0;
  let lockedUntil = 0;

  fastify.post('/demo/reset', async (request, reply) => {
    const { actor } = request;

    if (actor.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'FORBIDDEN_ROLE', message: 'Only ADMIN may trigger a demo reset' });
    }

    const now = Date.now();
    if (now < lockedUntil) {
      return reply.code(429).send({
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many failed demo reset attempts; try again later',
      });
    }

    const suppliedToken = request.headers['x-demo-reset-token'];
    if (!tokenMatches(token, suppliedToken)) {
      if (now - firstFailureAt > FAILED_ATTEMPT_WINDOW_MS) {
        firstFailureAt = now;
        failedAttempts = 0;
      }
      failedAttempts += 1;
      if (failedAttempts >= MAX_FAILED_TOKEN_ATTEMPTS) {
        lockedUntil = now + LOCKOUT_MS;
      }
      // Never log the supplied value itself — only that an attempt failed.
      request.log.warn({ failedAttempts }, 'demo reset: invalid token attempt');
      return reply.code(403).send({ error: 'INVALID_RESET_TOKEN', message: 'Demo reset token is missing or incorrect' });
    }
    failedAttempts = 0;

    if (now - lastSuccessfulResetAt < MIN_RESET_INTERVAL_MS) {
      return reply.code(429).send({
        error: 'RESET_RATE_LIMITED',
        message: 'A demo reset already ran recently; try again shortly',
      });
    }

    if (request.body?.confirm !== 'RESET_DEMO_DATA') {
      return reply.code(400).send({
        error: 'CONFIRMATION_REQUIRED',
        message: 'Send {"confirm":"RESET_DEMO_DATA"} to proceed',
      });
    }

    try {
      const result = await demoResetService.resetDemoData({ actorName: actor.name, actorRole: actor.role });
      lastSuccessfulResetAt = Date.now();
      return result;
    } catch (error) {
      if (error.code === 'RESET_IN_PROGRESS') {
        return reply.code(409).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}

module.exports = demoResetRoutes;
