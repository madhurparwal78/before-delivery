import pg from 'pg';
import { config } from './config.js';

const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

pg.types.setTypeParser(DATE_OID, (value) => value);
pg.types.setTypeParser(INT8_OID, (value) => Number(value));
pg.types.setTypeParser(NUMERIC_OID, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', () => {});

export async function query(text, values) {
  return pool.query(text, values);
}

export async function rows(text, values) {
  const result = await pool.query(text, values);
  return result.rows;
}

export async function one(text, values) {
  const result = await pool.query(text, values);
  return result.rows[0] ?? null;
}

/** Runs the body in one database transaction, committing only when it returns. */
export async function transaction(body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

export const LOCKS = {
  seed: 727401,
  audit: 727402,
  policy: 727403,
  raiserApprovals: 727404,
  shareMint: 727405,
};

/** Takes a transaction-scoped advisory lock, released when the transaction ends. */
export async function lock(client, key, discriminator = 0) {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [key, discriminator]);
}
