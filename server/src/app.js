
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const planRoutes = require('./routes/planRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const { ERROR_STATUS_MAP } = require('./utils/errorStatusMap');

function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });

  app.get('/ping', async () => {
    return {
      status: 'ok',
      message: 'Union PDI API is running'
    };
  });

  app.register(planRoutes, { prefix: '/api' });
  app.register(settingsRoutes, { prefix: '/api' });

  app.setErrorHandler((error, request, reply) => {
    const mappedStatus = ERROR_STATUS_MAP[error.code];
    if (mappedStatus) {
      reply.code(mappedStatus).send({ error: error.code, message: error.message });
      return;
    }

    // Fastify's own framework-level errors (malformed JSON body, routing,
    // validation) carry a FST_ERR_* code and a legitimate 4xx statusCode —
    // that's the recognized signal that it's safe to report back verbatim,
    // as opposed to an arbitrary unmapped error that might be a real bug.
    const isFastifyClientError =
      typeof error.code === 'string' &&
      error.code.startsWith('FST_ERR_') &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode < 500;

    if (isFastifyClientError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  return app;
}

module.exports = buildApp;
