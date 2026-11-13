import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });

/** An idle connection lost while Postgres restarts must not crash the process: the pool reconnects on the next query. */
pool.on("error", (error) => console.error("postgres connection error", error.message));

type Row = Record<string, unknown>;
export type Executor = Pick<pg.PoolClient, "query">;

export async function query<T = Row>(sql: string, params: unknown[] = [], executor: Executor = pool): Promise<T[]> {
  const result = await executor.query(sql, params);
  return result.rows as T[];
}

export async function one<T>(sql: string, params: unknown[] = [], executor: Executor = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, executor))[0];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
