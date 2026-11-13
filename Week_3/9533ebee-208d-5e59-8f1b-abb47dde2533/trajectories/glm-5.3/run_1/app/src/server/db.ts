import pg from 'pg';
import { getConfig } from './config.js';

const BIGINT_OID = 20n;
pg.types.setTypeParser(Number(BIGINT_OID), (value: string): string => value);
// numeric(78,0) money columns arrive as strings already; nothing to override.

export type Queryable = pg.PoolClient;

import { problem } from './problems.js';

export interface Tx {
  client: pg.PoolClient;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query<T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

export class Pool {
  private readonly pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool({
      connectionString: getConfig().databaseUrl,
      max: 20,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 4_000,
    });
    // A dropped idle connection must not crash the process: the pool
    // replaces it on the next checkout.
    this.pool.on('error', (err: Error): void => {
      void err;
    });
  }

  get raw(): pg.Pool {
    return this.pool;
  }

  async withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw toLedgerError(err);
    }
    let failure: unknown = null;
    try {
      return await fn(client);
    } catch (err) {
      failure = err;
      throw toLedgerError(err);
    } finally {
      if (failure === null) client.release();
      else client.release(failure instanceof Error ? failure : new Error('connection broken'));
    }
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withClient(async (client): Promise<T> => {
      const tx: Tx = {
        client,
        begin: async (): Promise<void> => {
          await client.query('BEGIN');
        },
        commit: async (): Promise<void> => {
          await client.query('COMMIT');
        },
        rollback: async (): Promise<void> => {
          await client.query('ROLLBACK');
        },
        query: async <U extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<U>> => {
          try {
            return await client.query<U>(text, params);
          } catch (err) {
            throw toLedgerError(err);
          }
        },
      };
      await tx.begin();
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // connection is already broken
        }
        throw err;
      }
    });
  }
}

export function toLedgerError(err: unknown): unknown {
  if (err instanceof pg.DatabaseError) {
    if (err.code !== undefined && ['23505', '23503', '23502', '23514', '22P02', '42601', '42703', '42P01'].includes(err.code)) {
      return err;
    }
    console.error('database error', err.code, err.message, err.detail ?? '');
    return problem(503, 'ledger_unavailable', 'The ledger is unreachable \u2013 nothing is confirmed. Try again shortly.');
  }
  if (err instanceof Error && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE'].includes(String((err as { code?: unknown }).code ?? ''))) {
    return problem(503, 'ledger_unavailable', 'The ledger is unreachable \u2013 nothing is confirmed. Try again shortly.');
  }
  return err;
}
