import pg from 'pg';
import { config } from './config.ts';

export interface Queryable {
  /** Runs one statement and returns its rows. */
  query<Row extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<Row[]>;
}

const RETRY_MS = 1000;

class Database implements Queryable {
  private readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

  constructor() {
    this.pool.on('error', (error) => console.error('database connection lost', error.message));
  }

  async query<Row extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.pool.query<Row>(sql, params)).rows;
  }

  /** Runs `work` in one transaction; any throw rolls it back. */
  async tx<T>(work: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let lost = false;
    try {
      await client.query('BEGIN');
      const result = await work({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // a connection that cannot even roll back is dropped, and the error that got us here is the one reported
      await client.query('ROLLBACK').catch(() => {
        lost = true;
      });
      throw error;
    } finally {
      client.release(lost);
    }
  }

  /** Runs `work` in a transaction that holds a PostgreSQL advisory lock until it ends, so two server copies on one database take turns. */
  withAdvisoryLock<T>(key: number, work: (q: Queryable) => Promise<T>): Promise<T> {
    return this.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock($1)', [key]);
      return work(q);
    });
  }

  /** Retries every second until PostgreSQL answers. */
  async connect(): Promise<void> {
    for (;;) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (error) {
        console.error('waiting for PostgreSQL:', error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export const db = new Database();

/** True for the error PostgreSQL raises when an insert breaks a unique constraint. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
