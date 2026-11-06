import pg from "pg";
import { config } from "./config.js";
import { SCHEMA_SQL } from "./schema.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export { pool };

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("select 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export type Tx = pg.PoolClient;
export type Db = pg.PoolClient | pg.Pool;

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

// Runs `fn` on a fresh pooled connection outside any open transaction. Used
// where committed data must be visible, as when a provider outcome is saved
// by a nested write while the caller's transaction stays open.
export async function withOwnTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function applySchema(): Promise<void> {
  await withTx(async (tx) => {
    await tx.query(SCHEMA_SQL);
  });
}

export type Row = Record<string, unknown>;


export async function query<T extends pg.QueryResultRow = Row>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return db.query<T>(text, params as unknown[]);
}

export async function rows<T extends pg.QueryResultRow = Row>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await query<T>(db, text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = Row>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const found = await rows<T>(db, text, params);
  return found.length > 0 ? found[0]! : null;
}

export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  if (!(err instanceof pg.DatabaseError)) return false;
  if (err.code !== "23505") return false;
  return constraint === undefined || err.constraint === constraint;
};

export const isExclusionViolation = (err: unknown): boolean =>
  err instanceof pg.DatabaseError && err.code === "23P01";
