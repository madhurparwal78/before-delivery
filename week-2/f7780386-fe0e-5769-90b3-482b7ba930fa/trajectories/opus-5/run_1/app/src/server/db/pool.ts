import pg from 'pg';

import { SCHEMA_SQL } from './schema.js';

// Kitchen dates are plain calendar dates; keep them as `YYYY-MM-DD` strings so
// no driver-side time zone ever touches them.
pg.types.setTypeParser(1082, (value: string) => value);

export class DatabaseUnavailable extends Error {
  constructor(cause: unknown) {
    super('database_unavailable');
    this.name = 'DatabaseUnavailable';
    this.cause = cause;
  }
}

/** Connection-level failures, as opposed to SQL errors that carry a SQLSTATE. */
function isConnectionFailure(error: unknown): boolean {
  if (error instanceof DatabaseUnavailable) return true;
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === 'string') {
    if (/^(08|53|57P0)/.test(code)) return true;
    if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(code)) {
      return true;
    }
    return false;
  }
  const message = (error as { message?: string } | null)?.message ?? '';
  return /terminat|connection|timeout|ECONNREFUSED|getaddrinfo/i.test(message);
}

export type TransactionRunner = <T>(work: (client: pg.PoolClient) => Promise<T>) => Promise<T>;

/**
 * Owns the connection pool and the one-time application of schema and seed
 * data. A database that is unreachable at boot never stops the server: the
 * schema is applied as soon as PostgreSQL answers.
 */
export class Database {
  readonly #pool: pg.Pool;
  readonly #applySeed: (runner: TransactionRunner) => Promise<void>;
  #ready = false;
  #preparing: Promise<void> | null = null;

  constructor(connectionString: string, applySeed: (runner: TransactionRunner) => Promise<void>) {
    this.#pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 4000 });
    this.#pool.on('error', () => {
      this.#ready = false;
    });
    this.#applySeed = applySeed;
  }

  get ready(): boolean {
    return this.#ready;
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    try {
      return await this.#pool.query<R>(text, params as unknown[]);
    } catch (error) {
      if (isConnectionFailure(error)) {
        this.#ready = false;
        throw new DatabaseUnavailable(error);
      }
      throw error;
    }
  }

  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      this.#ready = false;
      throw new DatabaseUnavailable(error);
    }
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is already gone; the transaction cannot outlive it.
      }
      if (isConnectionFailure(error)) {
        this.#ready = false;
        throw new DatabaseUnavailable(error);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** True once schema and seed are in place; false while PostgreSQL is down. */
  async ensureReady(): Promise<boolean> {
    if (this.#ready) return true;
    try {
      await this.prepare();
    } catch {
      return false;
    }
    return this.#ready;
  }

  /** Applies schema and seed. Safe to call repeatedly and concurrently. */
  async prepare(): Promise<void> {
    if (this.#ready) return;
    if (this.#preparing) return this.#preparing;
    const run = (async () => {
      try {
        await this.#pool.query(SCHEMA_SQL);
        await this.#applySeed((work) => this.transaction(work));
        this.#ready = true;
      } finally {
        this.#preparing = null;
      }
    })();
    this.#preparing = run;
    return run;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
