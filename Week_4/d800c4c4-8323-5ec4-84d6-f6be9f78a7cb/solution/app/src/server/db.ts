import pg from "pg";
import { config } from "./config.js";

// int8 (counts, sums) and dates come back as plain values the domain code expects.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Db = pg.Pool | pg.PoolClient;

// A pooled client runs one query at a time: reads fanned out with Promise.all on a
// transaction's client wait their turn here instead of overlapping on the connection.
const clientQueues = new WeakMap<pg.PoolClient, Promise<unknown>>();

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  if (db === pool) return (await pool.query(sql, params)).rows as T[];
  const client = db as pg.PoolClient;
  const run = (clientQueues.get(client) ?? Promise.resolve()).then(() => client.query(sql, params));
  clientQueues.set(client, run.catch(() => undefined));
  return (await run).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
