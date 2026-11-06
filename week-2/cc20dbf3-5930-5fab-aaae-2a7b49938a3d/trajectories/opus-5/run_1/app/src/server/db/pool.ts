import pg from 'pg';

/** Local dates are read back as plain strings and handled by the calendar code. */
pg.types.setTypeParser(1082, (value: string) => value);

export type Database = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 16, idleTimeoutMillis: 30_000 });
  pool.on('error', () => {
    /* idle client errors are recovered by the pool; nothing is logged in full */
  });
  return pool;
}

export async function waitForDatabase(pool: Database): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

/** Runs the body in one transaction, rolling back on any failure. */
export async function inTransaction<T>(
  pool: Database,
  body: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await body(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is already broken; releasing it below discards it */
    }
    throw error;
  } finally {
    client.release();
  }
}
