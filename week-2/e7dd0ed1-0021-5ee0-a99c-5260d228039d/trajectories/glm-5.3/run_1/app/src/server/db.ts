import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/farshore', max: 20 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params as never[]);
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await pool.query<T>(sql, params as never[]);
  return r.rows[0] ?? null;
}

export async function rows<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(sql, params as never[]);
  return r.rows;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection gone */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Runs fn inside a transaction holding a per-key advisory lock. */
export async function txLock<T>(lockKey: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return tx(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    return fn(client);
  });
}

export async function dbUp(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

export function dbError(e: unknown): boolean {
  return e instanceof Error && ('code' in e && typeof (e as { code?: unknown }).code === 'string' && (e as { code: string }).code?.startsWith?.('0') === true);
}

export default pool;
