import pg from 'pg';

export type Row = Record<string, any>;
export type Db = pg.Pool;

pg.types.setTypeParser(20, (v: string) => parseInt(v, 10)); // int8 -> number
pg.types.setTypeParser(23, (v: string) => parseInt(v, 10)); // int4 -> number
pg.types.setTypeParser(21, (v: string) => parseInt(v, 10)); // int2 -> number
pg.types.setTypeParser(700, parseFloat);
pg.types.setTypeParser(701, parseFloat);
pg.types.setTypeParser(1114, (v: string) => v); // timestamp without tz, raw
pg.types.setTypeParser(1184, (v: string) => new Date(v)); // timestamptz -> Date
pg.types.setTypeParser(1082, (v: string) => v); // date, raw YYYY-MM-DD

export interface Tx {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  release(): void;
}

let pool: pg.Pool | null = null;

export function connectDb(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000 });
  }
  return pool;
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const p = connectDb();
  const client = await p.connect();
  let released = false;
  const tx: Tx = {
    query: (sql, params) => client.query(sql, params as any[]).then(r => r.rows),
    release: () => { if (!released) { released = true; client.release(); } }
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection gone */ }
    throw e;
  } finally {
    tx.release();
  }
}

export async function txQuery(sql: string, params?: unknown[]): Promise<Row[]> {
  return withTx(tx => tx.query(sql, params));
}
