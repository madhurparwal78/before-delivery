import pg from "pg";
import { config } from "./config";
import { SCHEMA } from "./schema";

pg.types.setTypeParser(20, (value) => Number(value));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export async function rows<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(sql, params)).rows;
}

export async function maybeOne<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R | null> {
  return (await rows<R>(db, sql, params))[0] ?? null;
}

/** The first row of a statement that always returns one (an INSERT or UPDATE with RETURNING, a lookup by a key just checked). */
export async function one<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R> {
  const row = (await rows<R>(db, sql, params))[0];
  if (!row) throw new Error("expected a row");
  return row;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for Postgres, retrying every second, then applies the schema idempotently. */
export async function connectAndMigrate(): Promise<void> {
  for (;;) {
    try {
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(7355608)");
        await client.query(SCHEMA);
      });
      return;
    } catch (error) {
      console.error("postgres is not ready:", error instanceof Error ? error.message : error);
      await sleep(1000);
    }
  }
}
