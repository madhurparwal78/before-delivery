import pg from "pg";
import { config } from "./config.js";
import { SCHEMA } from "./schema.js";

pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient;

export async function tx<T>(work: (client: Db) => Promise<T>): Promise<T> {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await sleep(500);
    }
  }
}

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7301)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(7301)");
  } finally {
    client.release();
  }
}

export async function databaseAnswers(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
