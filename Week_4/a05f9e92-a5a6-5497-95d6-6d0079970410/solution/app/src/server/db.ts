import pg from "pg";
import { connection } from "./config.js";
import { SCHEMA } from "./schema.js";

pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());
pg.types.setTypeParser(20, (value: string) => Number(value));

export type Row = Record<string, unknown>;

const pool = new pg.Pool({ connectionString: connection.databaseUrl, max: 12 });
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

export interface Tx {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Callbacks that run once this transaction has committed. */
  after: Array<() => Promise<void> | void>;
}

function wrap(client: pg.PoolClient): Tx {
  return {
    after: [],
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query(sql, params);
      return result.rows as T[];
    },
  };
}

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx = wrap(client);
  try {
    await client.query("BEGIN");
    const result = await run(tx);
    await client.query("COMMIT");
    client.release();
    for (const callback of tx.after) await callback();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function connectWithRetry(onWait: () => void): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      onWait();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7401)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(7401)");
  } finally {
    client.release();
  }
}

/** Next number of a sequence, taken inside the saving transaction so a rolled-back save leaves no gap. */
export async function nextSequence(tx: Tx, name: string): Promise<number> {
  const rows = await tx.query<{ value: number }>(
    "INSERT INTO sequences (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = sequences.value + 1 RETURNING value",
    [name],
  );
  return rows[0]!.value;
}

/** Serialises the transactions that check-then-write one key: the lock is held until this transaction ends. */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}

export function pad(value: number): string {
  return String(value).padStart(6, "0");
}
