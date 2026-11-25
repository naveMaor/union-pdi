
const Fastify = require('fastify');
const cors = require('@fastify/cors');

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

  return app;
}

module.exports = buildApp;
