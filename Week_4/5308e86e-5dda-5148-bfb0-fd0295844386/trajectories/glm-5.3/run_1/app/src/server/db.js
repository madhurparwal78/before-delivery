import pg from 'pg';
import { DATABASE_URL, MAX_DB_CONNECTIONS } from './config.js';
import { ApiError } from './http.js';
import { now } from './clock.js';

// One pool with a hard cap of ten connections, shared by requests, streams,
// the scheduler and schema work. No stream holds a connection for its life.
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: MAX_DB_CONNECTIONS,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
});

// Drives all failures through one path; sqlState text never reaches a client.
export async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    throw dbError(err);
  }
}

export async function withTransaction(fn) {
  const client = await pool.connect().catch((err) => { throw dbError(err); });
  let done = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    done = true;
    return result;
  } catch (err) {
    if (!done) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    }
    // Business errors (ApiError) pass through untouched; only driver failures
    // become the opaque database error.
    if (err instanceof ApiError) throw err;
    throw dbError(err);
  } finally {
    client.release();
  }
}

export function dbError(err) {
  if (err && err.__db) return err;
  if (process.env.TW_DEBUG) console.error('DB ERROR:', err && err.message, err && err.code);
  const e = new Error('database error');
  e.__db = true;
  if (err && err.code === '28P01') e.__auth = true;
  else if (err && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === '57P03' || err.code === '08006' || err.code === '08001' || err.code === '08004')) e.__unreachable = true;
  else if (err) e.__internal = true;
  return e;
}

export function isUnreachable(err) {
  return !!(err && (err.__unreachable || err.__auth));
}

export async function ping() {
  await pool.query('SELECT 1');
  return true;
}

// All timestamps come from the business clock, never the database clock.
export function nowTs() {
  return new Date(now());
}

export async function end() {
  await pool.end().catch(() => {});
}
