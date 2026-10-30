import pg from "pg";

// DATE columns stay `YYYY-MM-DD` Pacific calendar dates; timestamps stay Date.
pg.types.setTypeParser(1082, (value: string) => value);

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Client = pg.PoolClient;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function query<T extends pg.QueryResultRow>(pool: Pool, text: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Runs `fn` inside a transaction on its own client. ROLLBACK is attempted
 * whenever the work fails, even if the transaction already ended.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the transaction already ended
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(pool: Pool, text: string, params: readonly unknown[] = []): Promise<T | null> {
  const result = await query<T>(pool, text, params);
  return result.rows[0] ?? null;
}

export async function rows<T extends pg.QueryResultRow>(pool: Pool, text: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await query<T>(pool, text, params);
  return result.rows;
}
