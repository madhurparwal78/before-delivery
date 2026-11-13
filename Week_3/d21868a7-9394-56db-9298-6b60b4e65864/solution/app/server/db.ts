// Postgres: one pool, one transaction helper, and the start-up loop that applies schema and seed.
import pg from "pg";
import { config } from "./config.ts";
import { databaseUnavailable } from "./http.ts";
import { applySchema } from "./schema.ts";
import { seedDistrict } from "./seed.ts";

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => BigInt(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export type Db = pg.PoolClient;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});
pool.on("connect", (client) => {
  // A client's connection can still fail while it is being discarded; that must not end the process.
  client.on("error", () => undefined);
});

let ready = false;

export function isReady(): boolean {
  return ready;
}

/** Every write that touches windows, orders, allocations, cards or capacity runs under this one lock,
 * so requests arriving at the same instant are judged one after another. */
const DISTRICT_LOCK = 26_2601;

export async function tx<T>(work: (db: Db) => Promise<T>, options: { lock: boolean } = { lock: true }): Promise<T> {
  let db: Db;
  try {
    db = await pool.connect();
  } catch {
    throw databaseUnavailable();
  }
  // A checked-out client that loses its connection between queries emits "error" on itself;
  // without a listener Node ends the process. Mark it broken so the pool discards it.
  let broken = false;
  const onLost = (): void => {
    broken = true;
  };
  db.on("error", onLost);
  try {
    await db.query("BEGIN");
    if (options.lock) await db.query("SELECT pg_advisory_xact_lock($1)", [DISTRICT_LOCK]);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw broken ? databaseUnavailable() : error;
  } finally {
    db.off("error", onLost);
    db.release(broken);
  }
}

/** A read outside any transaction. */
export async function read<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return tx(work, { lock: false });
}

/** Applies schema and seed, retrying every few seconds until Postgres answers. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await tx(async (db) => {
        await applySchema(db);
        await seedDistrict(db);
      });
      ready = true;
      return;
    } catch (error) {
      console.error(`database not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
