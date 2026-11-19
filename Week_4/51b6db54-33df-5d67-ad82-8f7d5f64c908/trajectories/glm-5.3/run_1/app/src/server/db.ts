import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export function createDb(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}

let thePool: Pool | null = null;
export function db(): Pool {
  if (!thePool) thePool = createDb();
  return thePool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query<T>(sql, params as never[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

/** Run fn inside one transaction on a single pooled client. */
export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Query bound to one client, for use inside inTransaction. */
export async function cQuery<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient, sql: string, params: unknown[] = []
): Promise<T[]> {
  const res = await client.query<T>(sql, params as never[]);
  return res.rows;
}

export async function cOne<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient, sql: string, params: unknown[] = []
): Promise<T | null> {
  const res = await client.query<T>(sql, params as never[]);
  return res.rows[0] ?? null;
}
