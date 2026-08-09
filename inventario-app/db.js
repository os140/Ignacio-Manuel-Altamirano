const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';
const shouldUseSsl = process.env.PGSSL === 'true' || (isProduction && process.env.PGSSL !== 'false');

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'inventario',
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
    };

const pool = new Pool(poolConfig);

async function query(text, params){
  return pool.query(text, params);
}

module.exports = {
  pool,
  query
};