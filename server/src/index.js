
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const buildApp = require('./app');

const app = buildApp();

async function start() {
  try {
    await app.listen({
      port: Number(process.env.PORT || 3001),
      host: process.env.HOST || '127.0.0.1'
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
