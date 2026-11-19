import pg from "pg";
import { config } from "../config.ts";

pg.types.setTypeParser(pg.types.builtins.DATE, (text) => text);
pg.types.setTypeParser(pg.types.builtins.INT8, (text) => BigInt(text));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres client error", error.message));

/** Postgres's code for a broken unique index. */
export const UNIQUE_VIOLATION = "23505";

export type Queryable = Pick<pg.PoolClient, "query">;

/** A row set from the pool, or from a transaction's client when one is passed. */
export async function query<Row>(text: string, params: readonly unknown[] = [], on: Queryable = pool): Promise<Row[]> {
  const result = await on.query(text, params as unknown[]);
  return result.rows as Row[];
}

export async function one<Row>(text: string, params: readonly unknown[] = [], on: Queryable = pool): Promise<Row | null> {
  const rows = await query<Row>(text, params, on);
  return rows[0] ?? null;
}

export async function tx<Result>(work: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
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
