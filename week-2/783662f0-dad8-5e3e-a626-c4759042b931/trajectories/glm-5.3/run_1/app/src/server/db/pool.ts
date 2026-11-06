import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type QueryResult<T extends pg.QueryResultRow> = pg.QueryResult<T>;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
}

/** Anything that can run a parameterised query: a pool, a client or a transaction. */
export interface Queryer {
  query<T extends object>(text: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

export type Tx = Queryer;

/** Runs fn inside a transaction. Callers that need cross-instance serialisation
 * take pg_advisory_xact_lock themselves. */
export async function withTx(pool: Pool, fn: (tx: Tx) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await fn({
        query: (text, params) => client.query(text, (params ?? []) as unknown[]) as Promise<pg.QueryResult<never>>,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Acquires an exclusive transaction-level advisory lock keyed by a string. */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}

/** Acquires a shared lock for readers of a key. */
export async function advisoryLockShared(tx: Tx, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [key]);
}
