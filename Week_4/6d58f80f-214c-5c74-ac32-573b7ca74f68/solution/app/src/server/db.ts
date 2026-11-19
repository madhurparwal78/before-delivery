// PostgreSQL: the system of record (brief: Services).
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient | pg.Pool;

export async function rows<T>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, values);
  return result.rows as T[];
}

export async function first<T>(db: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, text, values))[0];
}

/** Runs `work` in one transaction; every count, ledger and total change of an action goes through here. */
export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === "23505";
}
