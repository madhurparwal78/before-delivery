import { Pool, type PoolClient } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export type Tx = PoolClient;

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection is gone; nothing to roll back
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Serialise holds and confirms for one kitchen date. */
export async function lockKitchenDate(tx: Tx, kitchenId: string, date: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${kitchenId}|${date}`]);
}
