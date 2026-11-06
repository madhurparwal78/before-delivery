import pg from 'pg';

// timestamptz values are returned as Date objects (pg default).
// Date columns come back as Date objects in local server time; we render them
// with toISOString().slice(0, 10) which is the UTC date. The server's zone is
// UTC, so this equals the stored date.

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  ssl: process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL) && process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function query(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/** Run a query on a client or the pool, returning rows. */
export async function run(client, sql, params) {
  if (client) {
    const result = await client.query(sql, params);
    return result.rows;
  }
  return query(sql, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

export class UniquenessViolation extends Error {
  constructor() {
    super('uniqueness violation');
  }
}

function isUniqueViolation(err) {
  return err && err.code === '23505';
}

export function translateDbError(err) {
  if (isUniqueViolation(err)) return new UniquenessViolation();
  return err;
}

export function toDay(date) {
  if (date == null) return null;
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}
