import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({
  connectionString: url,
  max: 10,
  idleTimeoutMillis: 30000,
});

export type Query = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
export const q: Query = (sql, params) => pool.query(sql, params as never[]);

export interface Tx {
  query: Query;
}

async function runInTx<T>(openTransaction: (query: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const txQuery: Query = (sql, params) => client.query(sql, params as never[]);
  try {
    await client.query("BEGIN");
    const out = await openTransaction(txQuery);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx((txQuery) => fn({ query: txQuery }));
}

/** Run fn inside an advisory lock on the station so contested slots have one winner. */
export async function withStationLock<T>(stationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx(async (txQuery) => {
    const h = stationLockHandle(stationId);
    await txQuery("SELECT pg_advisory_xact_lock($1)", [h]);
    return fn({ query: txQuery });
  });
}

function stationLockHandle(stationId: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < stationId.length; i++) {
    h ^= BigInt(stationId.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // pg_advisory_xact_lock takes bigint; keep inside signed 63-bit
  if (h >= 0x8000000000000000n) h -= 0x10000000000000000n;
  return h;
}
