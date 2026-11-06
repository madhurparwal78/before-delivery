import pg from "pg";

export type Client = pg.PoolClient;
export type Pool = pg.Pool;

let pool: Pool | null = null;
let databaseOk = true;

export function initPool(connectionString: string): void {
  pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {
    // A background idle client died; the pool replaces it. Nothing to surface here.
  });
}

export function poolRef(): Pool {
  if (!pool) throw new Error("pool not initialised");
  return pool;
}

export function setDatabaseOk(ok: boolean): void {
  databaseOk = ok;
}

export function isDatabaseOk(): boolean {
  return databaseOk;
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await poolRef().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return poolRef().query<T>(text, params as never[]);
}

export async function inTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await poolRef().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection already broken; the release below returns it to the pool.
    }
    throw e;
  } finally {
    client.release();
  }
}
