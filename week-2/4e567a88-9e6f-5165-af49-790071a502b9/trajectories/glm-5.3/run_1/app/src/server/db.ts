// Postgres pool, transactions and id generation.
import pg from "pg";
import type { QueryResultRow } from "pg";
import { randomBytes } from "node:crypto";

export const MICRO = 1_000_000;

export class Pool {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  }

  query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(sql, params as never[]);
  }

  async one<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const r = await this.query<T>(sql, params);
    return r.rows[0] ?? null;
  }

  async many<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.query<T>(sql, params);
    return r.rows;
  }

  async tx<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: Tx = {
        one: async <U extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<U | null> => {
          const r = await client.query<U>(sql, params as never[]);
          return r.rows[0] ?? null;
        },
        many: async <U extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<U[]> => {
          const r = await client.query<U>(sql, params as never[]);
          return r.rows;
        },
        exec: async (sql: string, params: unknown[] = []): Promise<number> => {
          const r = await client.query(sql, params as never[]);
          return r.rowCount ?? 0;
        },
      };
      const out = await fn(tx);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const r = await this.query(sql, params);
    return r.rowCount ?? 0;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export interface Tx {
  one<T extends QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  many<T extends QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

/** A top-up id: tu_ followed by 16 random lowercase hex characters. */
export function newTopUpId(): string {
  return `tu_${randomBytes(8).toString("hex")}`;
}

/** A webhook event id: evt_ followed by 24 hex characters. */
export function newEventId(): string {
  return `evt_${randomBytes(12).toString("hex")}`;
}

/** A session token. */
export function newSessionToken(): string {
  return randomBytes(24).toString("hex");
}

/** A webhook signing secret: whsec_ plus 32 lowercase hex characters. */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(16).toString("hex")}`;
}
