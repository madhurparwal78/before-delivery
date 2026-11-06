import pg from "pg";

const config = {
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export const pool = new pg.Pool(config);

export async function query<T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Runs work in a transaction with a retry on serialization failure. */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (e as { code?: string }).code;
      if (code === "40001" || code === "40P01") {
        lastError = e;
        const jitter = Math.floor(Math.random() * 20);
        await new Promise((r) => setTimeout(r, 5 * (attempt + 1) + jitter));
        continue;
      }
      client.release();
      throw e;
    }
  }
  client.release();
  throw lastError ?? new Error("transaction retries exhausted");
}

export type PoolClient = pg.PoolClient;
export type QueryResultRow = pg.QueryResultRow;
