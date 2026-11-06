import { Pool, PoolClient, type QueryResultRow } from 'pg';

export interface Tx extends PoolClient {}

export interface Db {
  pool: Pool;
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  query<R extends QueryResultRow = QueryResultRow>(sql: string, args?: unknown[]): Promise<R[]>;
}

/** Query on a transaction when one is open, otherwise on the pool. */
export async function q<T extends QueryResultRow>(
  db: Db,
  tx: Tx | null,
  sql: string,
  args?: unknown[],
): Promise<T[]> {
  if (tx) {
    const result = await tx.query<T>(sql, args);
    return result.rows;
  }
  return db.query<T>(sql, args);
}

export function createDb(connectionString: string): Db {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return {
    pool,
    async withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        const result = await fn(tx);
        await tx.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await tx.query('ROLLBACK');
        } catch {
          // connection already broken; releasing is what matters
        }
        throw err;
      } finally {
        tx.release();
      }
    },
    async query<R extends QueryResultRow = QueryResultRow>(sql: string, args?: unknown[]): Promise<R[]> {
      const result = await pool.query(sql, args);
      return result.rows as R[];
    },
  };
}

/** Transaction-level advisory lock, held until the transaction ends. */
export async function lockKey(tx: Tx, scope: string, id: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [scope, id]);
}
