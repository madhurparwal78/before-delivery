/**
 * The Postgres pool and the one query helper every store uses.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { Pool, types } = pg;

// Read BIGINT and NUMERIC as text so no value passes through a binary float.
types.setTypeParser(20, (value) => value);
types.setTypeParser(1700, (value) => value);
// Read DATE as its own `YYYY-MM-DD` text, never a zoned Date.
types.setTypeParser(1082, (value) => value);

export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  one<T extends Row = Row>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}

export type DbPool = pg.Pool;

export function createPool(databaseUrl: string): DbPool {
  return new Pool({ connectionString: databaseUrl, max: 12, idleTimeoutMillis: 30_000 });
}

function wrap(runner: pg.Pool | pg.PoolClient): Db {
  return {
    async query<T extends Row>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      const result = await runner.query(sql, values as unknown[]);
      return result.rows as T[];
    },
    async one<T extends Row>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
      const result = await runner.query(sql, values as unknown[]);
      return (result.rows[0] as T | undefined) ?? null;
    },
    async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
      if ('connect' in runner) {
        const client = await (runner as pg.Pool).connect();
        try {
          await client.query('BEGIN');
          const out = await work(wrap(client));
          await client.query('COMMIT');
          return out;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
      return work(wrap(runner));
    },
  };
}

export function db(pool: pg.Pool): Db {
  return wrap(pool);
}

// ------------------------------------------------------------------ passwords

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const key = scryptSync(password, salt, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
