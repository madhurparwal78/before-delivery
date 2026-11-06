import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(1082, (value) => value);

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<R extends pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(text, values)).rows;
}

export async function one<R extends pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<R | null> {
  return (await rows<R>(db, text, values))[0] ?? null;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof pg.DatabaseError) || error.code !== "23505") return false;
  return constraint === undefined || error.constraint === constraint;
}

/** A statement that always returns its row (an insert or update with `returning`, or a read of a row known to exist). */
export async function returning<R extends pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<R> {
  return (await rows<R>(db, text, values))[0] as R;
}
