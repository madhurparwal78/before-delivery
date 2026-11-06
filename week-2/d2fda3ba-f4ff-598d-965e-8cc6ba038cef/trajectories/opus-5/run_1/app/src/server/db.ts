import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { SCHEMA_SQL } from './schema';

// Dates stay as calendar strings, so an account's billing end date never shifts with the server's zone.
types.setTypeParser(1082, (value) => value);

export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12 });
    this.pool.on('error', () => undefined);
  }

  async query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  async one<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Runs work while holding a session-level advisory lock, or returns null when it is taken. */
  async withAdvisoryLock<T>(classId: number, key: string, run: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const locked = await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock($1, hashtext($2)) as acquired',
        [classId, key],
      );
      if (!locked.rows[0]?.acquired) return null;
      try {
        return await run();
      } finally {
        await client.query('select pg_advisory_unlock($1, hashtext($2))', [classId, key]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async waitUntilReady(): Promise<void> {
    for (;;) {
      try {
        await this.pool.query('select 1');
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  async applySchema(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }
}

export const LOCK_CLASS_SWEEP = 1;
export const LOCK_CLASS_PUBLISH = 2;
export const LOCK_CLASS_VAULT = 3;
