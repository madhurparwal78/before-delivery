import pg from 'pg';
import { config } from '../config.js';

export type Queryable = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
};

const DATE_OID = 1082;
// Toronto dates are plain YYYY-MM-DD strings everywhere in this app, never JS Date values.
pg.types.setTypeParser(DATE_OID, (value: string) => value);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16 });

pool.on('error', () => {
  // Idle clients can be dropped by the server; the pool opens a fresh one on the next query.
});

export const db: Queryable = {
  query: (text, values) => pool.query(text, values as unknown[] | undefined),
};

export async function withTransaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
