
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
    origin: 'http://localhost:5173'
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
    const status = ERROR_STATUS_MAP[error.code];
    if (status) {
      reply.code(status).send({ error: error.code, message: error.message });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  return app;
}

module.exports = buildApp;
