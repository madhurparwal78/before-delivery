import pg from "pg";

const { Pool } = pg;

export type Db = pg.Pool;

export interface TxClient extends pg.PoolClient {}

export function createPool(connectionString: string): Db {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  return pool;
}

export async function withTransaction<T>(db: Db, fn: (client: TxClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection gone */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function withClient<T>(db: Db, fn: (client: TxClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
