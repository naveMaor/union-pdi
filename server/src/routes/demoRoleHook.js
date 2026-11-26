'use strict';

// Fixed demo users (SPEC §4) — role simulation only, not authentication. The
// server resolves the actor NAME from the role code itself; a client can never
// supply its own name.
const DEMO_USERS = {
  PLANNER: 'מיכל לוי',
  SHIPPING: 'יוסי כהן',
  ADMIN: 'רונית שמש',
};

async function demoRoleHook(request, reply) {
  const role = request.headers['x-demo-role'];
  if (!role || !DEMO_USERS[role]) {
    reply.code(400).send({
      error: 'INVALID_DEMO_ROLE',
      message: 'x-demo-role header must be one of PLANNER, SHIPPING, ADMIN',
    });
    return reply;
  }
  request.actor = { role, name: DEMO_USERS[role] };
}

module.exports = { demoRoleHook, DEMO_USERS };
