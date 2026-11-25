require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') });

const base = {
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  dialect: 'postgres',
};

module.exports = {
  development: base,
  test: { ...base, database: process.env.POSTGRES_DB_TEST || `${base.database}_test` },
  production: base,
};
