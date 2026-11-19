import pg from "pg";
import { config } from "./config.ts";
import { SCHEMA } from "./schema.ts";

/** Postgres bigint columns hold ufern, always far below 2^53. */
pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function maybeOne<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

export async function run(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query(sql, params)).rowCount ?? 0;
}

/** Work to do once the surrounding transaction has committed (pushes, mail kicks). */
export type AfterCommit = (work: () => void) => void;

export async function transaction<T>(body: (db: pg.PoolClient, after: AfterCommit) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const deferred: Array<() => void> = [];
  try {
    await client.query("BEGIN");
    const result = await body(client, (work) => deferred.push(work));
    await client.query("COMMIT");
    for (const work of deferred) work();
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** One writer at a time: every write and every engine step runs through here. */
let tail: Promise<unknown> = Promise.resolve();

export function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => undefined);
  return result;
}

export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(7351)");
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock(7351)");
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      console.error("database not ready, retrying:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
