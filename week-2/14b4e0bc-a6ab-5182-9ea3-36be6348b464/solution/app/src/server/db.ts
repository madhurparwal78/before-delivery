import pg from "pg";
import { config } from "./config.ts";

pg.types.setTypeParser(20, (value: string) => Number(value));

/** At most 10 pooled connections plus the one listener: within the 12-connection bound (DP-83). */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 10_000,
  application_name: "strata",
});
pool.on("error", () => undefined);

export type Tx = pg.PoolClient;

export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>, mode = "BEGIN"): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query(mode);
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

/** A consistent read snapshot for multi-query reads. */
export function readSnapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(fn, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
}
