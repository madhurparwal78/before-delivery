// PostgreSQL, the system of record. Advisory locks serialise claims across every app process.
import pg from "pg";
import { createHash } from "node:crypto";
import { config } from "./config";

// Return DATE columns as plain kitchen dates instead of Date objects.
pg.types.setTypeParser(1082, (value: string) => value);
// BIGINT sums are small enough for numbers.
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30 });

export type Db = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

export async function withClient<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

/** Runs work in one transaction; commits when it returns, rolls back when it throws. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return withClient(async (db) => {
    await db.query("BEGIN");
    try {
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}

export function lockKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest().readBigInt64BE(0).toString();
}

/** A transaction-scoped advisory lock: claims on the same key are decided one at a time. */
export async function lockFor(db: Db, ...parts: string[]): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey(...parts)]);
}

export async function audit(db: Queryable, actorId: string | null, entity: string, entityId: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query("INSERT INTO audit_trail (actor_user_id, entity, entity_id, action, detail) VALUES ($1, $2, $3, $4, $5)", [actorId, entity, entityId, action, JSON.stringify(detail)]);
}
