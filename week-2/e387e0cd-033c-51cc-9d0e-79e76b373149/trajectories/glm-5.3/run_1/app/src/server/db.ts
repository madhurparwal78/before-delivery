import pg from 'pg';

export type QueryResultRow = Record<string, unknown>;

const pools = new Map<string, pg.Pool>();

export function pool(): pg.Pool {
  const url = process.env.DATABASE_URL ?? '';
  let p = pools.get(url);
  if (p === undefined) {
    p = new pg.Pool({ connectionString: url, max: 10 });
    pools.set(url, p);
  }
  return p;
}

export interface Rows<T> { rows: T[]; rowCount: number | null }

export async function query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<Rows<T>> {
  return pool().query(sql, params as unknown[]) as unknown as Rows<T>;
}

export async function withTransaction<T>(fn: (q: (sql: string, params?: readonly unknown[]) => Promise<Rows<Record<string, unknown>>>, client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const q = (sql: string, params: readonly unknown[] = []) => client.query(sql, params as unknown[]) as unknown as Promise<Rows<Record<string, unknown>>>;
    const out = await fn(q, client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
