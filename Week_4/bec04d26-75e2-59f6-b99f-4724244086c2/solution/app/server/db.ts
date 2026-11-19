import pg from "pg";
import { config } from "./config";
import { SCHEMA } from "./schema";

const { types } = pg;
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1184, (value) => new Date(value).toISOString());

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 10000 });
pool.on("error", () => undefined);

export type Db = Pick<pg.PoolClient, "query">;

export async function query<Row extends object = Record<string, unknown>>(
  db: Db, sql: string, params: unknown[] = [],
): Promise<Row[]> {
  return (await db.query(sql, params)).rows as Row[];
}

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Resolves once Postgres answers and the schema is applied; keeps trying every two seconds until it does. */
export const databaseReady: Promise<void> = (async () => {
  for (;;) {
    try {
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(40317)");
        await client.query(SCHEMA);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
})();

/** Whether Postgres answers a fresh connection quickly, whatever the pool is doing. */
export async function databaseAnswers(): Promise<boolean> {
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 1500, query_timeout: 1500 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
