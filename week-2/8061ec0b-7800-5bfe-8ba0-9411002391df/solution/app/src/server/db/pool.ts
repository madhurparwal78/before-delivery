// Postgres access: the pool, transactions, and the advisory locks that serialise contract actions and the fleet.

import pg from "pg";
import { config } from "../config.js";
import { ApiError } from "../http/errors.js";

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, idleTimeoutMillis: 5_000 });
pool.on("error", (error) => console.error("postgres idle client error", error.message));

export type Db = pg.PoolClient;
export type Queryable = Db | pg.Pool;

export async function query<R extends pg.QueryResultRow>(db: Queryable, text: string,
  values: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(text, values)).rows;
}

/**
 * Checks a client out of the pool. The pool only listens for errors on idle clients, so a checked-out one gets its
 * own listener: a server-side termination between statements then surfaces on the next query instead of crashing.
 */
export async function checkout(): Promise<Db> {
  const db = await pool.connect();
  const onError = (error: Error) => console.error("postgres client error", error.message);
  db.on("error", onError);
  const release = db.release.bind(db);
  db.release = (destroy?: boolean | Error) => {
    db.off("error", onError);
    release(destroy);
  };
  return db;
}

export async function withClient<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await checkout();
  try {
    const result = await work(db);
    db.release();
    return result;
  } catch (error) {
    // A refusal or a failed statement leaves the session usable; anything else (a dropped socket) retires the
    // connection, which also frees any advisory lock it held.
    const usable = error instanceof ApiError || error instanceof pg.DatabaseError;
    db.release(usable ? undefined : true);
    throw error;
  }
}

export async function inTransaction<T>(db: Db, work: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return withClient((db) => inTransaction(db, () => work(db)));
}

const FLEET_LOCK = "fleet";

/**
 * Runs `work` holding the contract's session advisory lock on one dedicated connection, so activation, payments,
 * reversals, buyouts, exchanges, returns and write-offs on one contract are taken strictly one at a time, on every
 * instance sharing the database. Waiters queue on the lock and then run their own checks against the result.
 */
export async function withContractLock<T>(contractId: string, work: (db: Db) => Promise<T>): Promise<T> {
  return withClient(async (db) => {
    await db.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`contract:${contractId}`]);
    try {
      return await work(db);
    } finally {
      await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`contract:${contractId}`]);
    }
  });
}

/** The fleet lock for the rest of the current transaction: one unit choice at a time (reservations). */
export async function lockFleetForTransaction(db: Db): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [FLEET_LOCK]);
}

/** The fleet lock held across an exchange's external calls, on the exchange's own connection. */
export async function withFleetLock<T>(db: Db, work: () => Promise<T>): Promise<T> {
  await db.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [FLEET_LOCK]);
  try {
    return await work();
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [FLEET_LOCK]);
  }
}
