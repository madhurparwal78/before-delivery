import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000
});

export type SqlValue = string | number | boolean | null | Date;

export async function query<T extends pg.QueryResultRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown as unknown[]);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: SqlValue[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      async query<T extends pg.QueryResultRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
        const result = await client.query<T>(sql, params as unknown as unknown[]);
        return result.rows;
      },
      async one<T extends pg.QueryResultRow>(sql: string, params: SqlValue[] = []): Promise<T | null> {
        const rows = await this.query<T>(sql, params);
        return rows[0] ?? null;
      }
    };
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

export interface Tx {
  query<T extends pg.QueryResultRow>(sql: string, params?: SqlValue[]): Promise<T[]>;
  one<T extends pg.QueryResultRow>(sql: string, params?: SqlValue[]): Promise<T | null>;
}
