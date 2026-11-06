// Postgres, the system of record and the coordination layer every instance shares (brief: Services, Postgres).
import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30, connectionTimeoutMillis: 10_000 });
pool.on("error", (error) => console.error(JSON.stringify({ level: "error", msg: "postgres pool error", error: error.message })));

// Dates stay `YYYY-MM-DD` strings and bigints stay numbers (booking numbers and sequence ids fit easily).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Queryable = Pick<pg.PoolClient, "query">;
export type Client = pg.PoolClient;

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** The row a query that always returns one (an insert's RETURNING, a just-locked record) produced. */
export function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Expected a row");
  return row;
}

/** Any one-shot query outside a transaction. */
export const db: Queryable = pool;

/** A dedicated client for work that spans several statements; the caller releases it. */
export const connect = (): Promise<pg.PoolClient> => pool.connect();

/** Closes every pooled connection at shutdown. */
export const closePool = (): Promise<void> => pool.end();
