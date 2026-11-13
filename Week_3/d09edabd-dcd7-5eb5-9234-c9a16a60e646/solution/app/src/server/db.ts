import pg from 'pg';
import { config } from './config.js';
import { SCHEMA } from './schema.js';
import { databaseUnavailable } from './errors.js';

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

const PROBE_MS = 2000;
const SCHEMA_LOCK = 481516;
const CONNECTION_FAILURE = /^(08|53|57P)/;
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);

/** The one Postgres client: a pool plus an availability flag fed by a probe and by failing queries. */
class Database implements Queryable {
  private pool: pg.Pool | null = null;
  private ready = false;
  private booted = false;
  private up = false;

  get available(): boolean {
    return this.up && this.ready && this.booted;
  }

  /** True once the schema is applied. */
  get migrated(): boolean {
    return this.ready;
  }

  /** The boot-time work (cookie secret, seed) is done: the app can serve. */
  markBooted(): void {
    this.booted = true;
  }

  start(): void {
    if (!config.databaseUrl) return;
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10_000 });
    this.pool.on('error', () => {
      this.up = false;
    });
    void this.watch();
  }

  private async watch(): Promise<void> {
    for (;;) {
      try {
        if (!this.ready) await this.migrate();
        await this.pool!.query('SELECT 1');
        this.up = true;
      } catch {
        this.up = false;
      }
      await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    }
  }

  private async migrate(): Promise<void> {
    const client = await this.pool!.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
      try {
        await client.query(SCHEMA);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
      }
      this.ready = true;
    } finally {
      client.release();
    }
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<R>> {
    if (!this.pool) throw databaseUnavailable();
    try {
      return await this.pool.query<R>(text, params);
    } catch (error) {
      throw this.classify(error);
    }
  }

  async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    if (!this.pool) throw databaseUnavailable();
    let client: pg.PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw this.classify(error);
    }
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw this.classify(error);
    } finally {
      client.release(broken ? new Error('connection lost') : undefined);
    }
  }

  private classify(error: unknown): unknown {
    const code = (error as { code?: string }).code ?? '';
    const message = (error as Error).message ?? '';
    if (CONNECTION_FAILURE.test(code) || CONNECTION_CODES.has(code) || /Connection terminated|timeout exceeded when trying to connect|connect ECONN/.test(message)) {
      this.up = false;
      return databaseUnavailable();
    }
    return error;
  }
}

export const db = new Database();

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
