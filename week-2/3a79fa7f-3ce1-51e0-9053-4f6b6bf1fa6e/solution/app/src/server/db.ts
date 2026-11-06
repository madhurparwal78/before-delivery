// PostgreSQL: the one datastore. Schema and seed are created idempotently at start under an advisory lock.
import pg from "pg";
import { config } from "./config.ts";
import { SCHEMA } from "./schema.ts";
import { seed } from "./seed.ts";

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

/** Runs `work` in one transaction; any throw (the commit included) rolls it back, then runs `onRollback`. */
export async function transaction<T>(work: (tx: Tx) => Promise<T>, onRollback?: () => Promise<void>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await onRollback?.();
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_LOCK = 7_340_001;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
    await seed(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** Takes the next value of a gap-free counter; the row stays locked until the transaction ends. */
export async function nextCounter(tx: Tx, name: "order" | "callback" | "case"): Promise<number> {
  const { rows } = await tx.query<{ value: number }>(
    "UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value",
    [name],
  );
  return rows[0]!.value;
}
