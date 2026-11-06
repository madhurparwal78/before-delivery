
import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

// DATE columns are read as plain ISO date strings, never as local-time Date
// objects, so a session's date never shifts with the server's time zone.
pg.types.setTypeParser(1082, (value: string) => value);

export function createPool(databaseUrl: string): Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    // Fail fast so requests answer `unavailable` rather than hanging.
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
  return pool;
}
