import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface DatabaseConfig { url: string }

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL ?? '';
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err: Error) => {
      void err;
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query(text, params as never[]);
}

/** The registry of Kill Bill accounts the app created, for reconciliation. */
export async function recordKbAccount(kbAccountId: string, externalKey: string): Promise<void> {
  await query(
    `INSERT INTO kb_accounts (kb_account_id, external_key) VALUES ($1,$2)
     ON CONFLICT (kb_account_id) DO NOTHING`,
    [kbAccountId, externalKey],
  );
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock<T>(lockKey: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    return fn(client);
  });
}
