// The Postgres pool, transactions and the advisory locks every cross-instance rule relies on.

import pg from "pg";
import { config } from "./config.js";

// int8 columns hold epoch seconds, serials, counts and milli-tonnes, all far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = pg.PoolClient;

export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

/** Several reads that must describe the same committed state. */
export async function snapshot<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// Advisory lock namespaces (first key of pg_advisory_xact_lock(int, int)).
const PROJECT_LOCK = 1;
const IDEMPOTENCY_LOCK = 2;
const SCHEMA_LOCK = 3;

/** Seals and ingestion batches of one project run one at a time across every instance. */
export async function lockProject(db: Db, slug: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [PROJECT_LOCK, slug]);
}

/** Seal requests with the same person and Idempotency-Key run one at a time across every instance. */
export async function lockIdempotencyKey(db: Db, personId: string, key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [IDEMPOTENCY_LOCK, `${personId}\n${key}`]);
}

/** Schema and seed are applied by one starting instance at a time. */
export async function lockSchema(db: Db): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1, 0)", [SCHEMA_LOCK]);
}

/** Waits for Postgres for up to 60 seconds. */
export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
