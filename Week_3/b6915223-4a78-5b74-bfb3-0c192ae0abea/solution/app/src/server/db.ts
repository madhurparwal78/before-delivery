import pg from "pg";
import type { LiveMessage } from "../shared/api.ts";
import { config } from "./config.ts";

// BIGINT ids and counts come back as JS numbers (they stay far below 2^53).
pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool:", error.message));

export type Db = pg.PoolClient;

export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

// Inside a transaction the notification goes out when the transaction commits.
export async function publish(db: Db | pg.Pool, message: LiveMessage | { t: "outbox" } | { t: "snapshots" }): Promise<void> {
  await db.query("SELECT pg_notify('elevens', $1)", [JSON.stringify(message)]);
}

export async function waitForPostgres(seconds: number): Promise<void> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      console.error("postgres unreachable, retrying:", (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
