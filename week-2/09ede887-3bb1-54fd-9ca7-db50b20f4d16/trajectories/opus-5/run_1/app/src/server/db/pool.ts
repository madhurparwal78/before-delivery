import pg from 'pg';
import type { Settings } from '../config.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export interface QueryResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}
export interface Queryable {
  query<Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;
}

/** PostgreSQL error classes that mean "try the whole transaction again". */
const RETRYABLE = new Set(['40001', '40P01']);

export function isRetryable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && RETRYABLE.has(error.code);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === '23505';
}

export class Database {
  private readonly pool: pg.Pool;

  constructor(settings: Settings) {
    this.pool = new pg.Pool({
      connectionString: settings.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30_000,
      application_name: 'keel-outpost',
    });
    this.pool.on('error', () => {
      // A dropped idle connection must not take the process down; the next
      // request opens a fresh one or answers `unavailable`.
    });
  }

  async query<Row>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<Row>> {
    const result = await this.pool.query(sql, params as unknown[]);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }

  async withClient<T>(body: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await body(wrap(client));
    } finally {
      client.release();
    }
  }

  async transaction<T>(body: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const value = await body(wrap(client));
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function wrap(client: pg.PoolClient): Queryable {
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<Row>> {
      const result = await client.query(sql, params as unknown[]);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    },
  };
}
