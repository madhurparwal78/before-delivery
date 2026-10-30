import pg from 'pg';
import { config } from '../config.js';

export class DatabaseUnavailableError extends Error {
  constructor(cause) {
    super('database unavailable');
    this.cause = cause;
  }
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
  '08000', '08003', '08006', '08001', '08004', '08007', '08P01', '57P01', '57P02', '57P03', '53300', '3D000'
]);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
  statement_timeout: 15000
});

pool.on('error', () => {});

function isConnectionFailure(error) {
  if (!error) return false;
  if (CONNECTION_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message || '');
  return message.includes('Connection terminated')
    || message.includes('timeout exceeded when trying to connect')
    || message.includes('Client has encountered a connection error')
    || message.includes('terminating connection')
    || message.includes('server closed the connection');
}

export function wrapDatabaseError(error) {
  return isConnectionFailure(error) ? new DatabaseUnavailableError(error) : error;
}

export async function query(text, params = []) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw wrapDatabaseError(error);
  }
}

export async function withClient(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw wrapDatabaseError(error);
  }
  try {
    return await fn(client);
  } catch (error) {
    throw wrapDatabaseError(error);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  return withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the connection is gone; the transaction is already discarded
      }
      throw error;
    }
  });
}

/** Every write transaction takes this lock first, which orders writes and keeps audit seq gapless. */
export async function lockOrganization(client, organizationId) {
  const result = await client.query(
    'SELECT id, webhook_secret, date_trunc(\'second\', now()) AS now FROM organizations WHERE id = $1 FOR UPDATE',
    [organizationId]
  );
  return result.rows[0] || null;
}

export async function serverNow(client) {
  const runner = client || { query };
  const result = await runner.query('SELECT date_trunc(\'second\', now()) AS now');
  return result.rows[0].now;
}
