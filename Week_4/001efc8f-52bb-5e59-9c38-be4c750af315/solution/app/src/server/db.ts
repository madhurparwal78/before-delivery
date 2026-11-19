import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 10_000 });
// A dropped idle connection must not crash the process; the next query reconnects.
pool.on("error", () => undefined);

export type Queryable = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

export async function rows<T extends Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<T>(sql, params);
  return result.rows[0];
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // A connection that cannot even roll back is broken; it leaves the pool instead of being reused.
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError: Error) => {
      broken = rollbackError;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

// Transaction-scoped advisory locks. Keys are namespaced by a small integer.
export const LOCK = { schema: 1, events: 2, author: 3, digest: 4 } as const;

export async function lock(client: pg.PoolClient, space: number, key = ""): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [space, key]);
}
