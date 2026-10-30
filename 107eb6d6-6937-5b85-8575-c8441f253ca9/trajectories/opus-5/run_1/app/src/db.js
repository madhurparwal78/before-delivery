import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { unavailable } from './domain/errors.js';
import { applySeed } from './seed.js';

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
const BOOTSTRAP_LOCK = 915231001;
const RETRY_DELAY_MS = 3000;

const CONNECTION_SQLSTATES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '28000', '28P01', '3D000', '53300', '53400', '57P01', '57P02', '57P03'
]);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

// pg emits 'error' on idle clients when the server drops the connection; without a
// listener Node turns that into an uncaught exception and the server would exit.
pool.on('error', () => {});

const reachability = (error) => {
  const sqlstate = typeof error?.code === 'string' ? error.code : '';
  return !/^[0-9A-Z]{5}$/.test(sqlstate) || CONNECTION_SQLSTATES.has(sqlstate);
};

const translate = (error) => {
  if (error?.status) return error;
  return reachability(error) ? unavailable() : error;
};

const databaseState = { ready: false };

export async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw translate(error);
  }
}

/** Pool-backed executor, interchangeable with a transaction client. */
export const db = { query: (text, params) => query(text, params) };

export async function withTransaction(run) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw translate(error);
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw translate(error);
  } finally {
    client.release();
  }
}

export async function isDatabaseReady() {
  if (!databaseState.ready) return false;
  await query('SELECT 1');
  return true;
}

async function applySchemaAndSeed() {
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    await client.query(schema);
    await applySeed(client);
  });
}

export function startDatabase() {
  const attempt = async () => {
    try {
      await applySchemaAndSeed();
      databaseState.ready = true;
      console.log('database ready: schema and seed applied');
    } catch (error) {
      databaseState.ready = false;
      console.warn(`database not ready yet (${error.message}); retrying in ${RETRY_DELAY_MS}ms`);
      setTimeout(attempt, RETRY_DELAY_MS).unref();
    }
  };
  attempt();
}
