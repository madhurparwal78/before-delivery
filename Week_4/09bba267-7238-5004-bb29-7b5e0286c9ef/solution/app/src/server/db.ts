import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 10_000 });
pool.on("error", (error) => console.error("postgres idle client error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

/** What a committed change tells every copy of the server (delivered by Postgres NOTIFY on commit). */
export type Notice =
  | { k: "seats"; p: string }
  | { k: "performances" }
  | { k: "buyer"; b: string }
  | { k: "hold_ended"; b: string; p: string; e: string }
  | { k: "offer"; b: string; t: string; l: string }
  | { k: "offer_closed"; t: string; by: string | null }
  | { k: "outbox" };

export const CHANNEL = "seatwise";

export async function notify(tx: Tx, notice: Notice): Promise<void> {
  await tx.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(notice)]);
}

const RETRYABLE = new Set(["40001", "40P01"]);

/** Runs `work` in one transaction; a deadlock or serialization failure is retried from the start. */
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (!(code && RETRYABLE.has(code) && attempt < 5)) throw error;
    } finally {
      client.release();
    }
  }
}
