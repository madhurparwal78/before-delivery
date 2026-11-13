import pg from "pg";
import { config } from "./config.js";
import { schemaSql } from "./schema.js";
import { seedSql } from "./seed.js";

const MIGRATION_LOCK = 7101;
const RETRY_MS = 1000;

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export const pool: Db = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool:", error.message));

let ready = false;
export const databaseReady = (): boolean => ready;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(schemaSql);
    await seedSql(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

// Postgres may be down at boot: keep trying until the schema and seed are in place.
export async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      ready = true;
      return;
    } catch (error) {
      console.error("postgres not ready:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}

export function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|57P0\d|08\w{3})$/.test(code) || /timeout exceeded when trying to connect|Connection terminated/.test(error.message);
}
