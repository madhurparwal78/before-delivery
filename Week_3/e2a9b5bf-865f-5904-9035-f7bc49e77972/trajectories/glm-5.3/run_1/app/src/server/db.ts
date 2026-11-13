// Database access layer. Every state-changing operation on one observation
// runs inside a transaction that takes a per-observation advisory lock, so
// changes serialise even across simultaneous sync requests (DP-65).
import { Pool, type PoolClient } from "pg";
import type { AppConfig } from "./config.js";
import { applySchema } from "./schema.js";
import { seedDatabase, seedAccountsIntoDatabase } from "./seed.js";
import type { StorageClient } from "./services/storage.js";

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 12,
  });
}

// Apply the schema and seed data idempotently (Services: Postgres).
export async function prepare(pool: Pool, config: AppConfig, storage: StorageClient): Promise<void> {
  await applySchema(pool);
  await seedDatabase(pool);
  const accountOutcomes = await seedAccountsIntoDatabase(pool);
  // Seeded stroke files that are missing at start are written once storage answers.
  for (const outcome of accountOutcomes) {
    for (const object of outcome.strokeObjects) {
      const exists = await readObjectOrNull(storage, object.key);
      if (!exists) {
        await storage.put(object.key, Buffer.from(object.text, "utf8"), "application/json");
      }
    }
  }
}

async function readObjectOrNull(storage: StorageClient, key: string): Promise<Uint8Array | null> {
  try {
    return await storage.get(key);
  } catch {
    return null;
  }
}

export async function waitForDatabase(pool: Pool): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken
    }
    throw error;
  } finally {
    client.release();
  }
}

export function observationLockKey(id: string): string {
  // A stable bigint for pg_advisory_xact_lock from the observation's uuid.
  const bytes = Buffer.from(id.replace(/-/g, "").padEnd(32, "0").slice(0, 32), "hex");
  const hi = bytes.readBigInt64BE(0);
  return hi.toString();
}

export function packetLockKey(id: string): string {
  const bytes = Buffer.from(id.replace(/-/g, "").padEnd(32, "0").slice(0, 32), "hex");
  const hi = bytes.readBigInt64BE(8);
  return hi.toString();
}
