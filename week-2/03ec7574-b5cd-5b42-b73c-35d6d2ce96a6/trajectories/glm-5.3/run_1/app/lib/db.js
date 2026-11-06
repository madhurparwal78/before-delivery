import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let ready = false;
let dbReachable = false;

export function poolRef() {
  return pool;
}

export function markReady(v) {
  ready = v;
}

export function markReachable(v) {
  dbReachable = v;
}

export function isReady() {
  return ready && dbReachable;
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    client.release();
  }
}

// Advisory lock, transaction-scoped when a client is given, session-scoped otherwise.
export async function advisoryLock(client, key) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [key]);
}

export async function query(sql, params) {
  return withClient((c) => c.query(sql, params));
}

export { pg };
