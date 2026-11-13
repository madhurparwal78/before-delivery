import pg from "pg";
import { config } from "./config.js";
import { schema } from "./schema.js";

pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3000 });
pool.on("error", () => undefined);

export type Db = Pick<pg.PoolClient, "query">;

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
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

export async function rows<T>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

export async function one<T>(db: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, text, values))[0];
}

export async function migrate(): Promise<void> {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7305)");
    await db.query(schema);
  });
}

export const database = { ready: false };

export async function connectWithRetry(onReady: () => Promise<void>): Promise<void> {
  let prepared = false;
  const check = async (): Promise<void> => {
    try {
      await pool.query("SELECT 1");
      if (!prepared) {
        await onReady();
        prepared = true;
      }
      database.ready = true;
    } catch {
      database.ready = false;
    }
  };
  while (!prepared) {
    await check();
    if (!prepared) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  setInterval(() => void check(), 2000).unref();
}
