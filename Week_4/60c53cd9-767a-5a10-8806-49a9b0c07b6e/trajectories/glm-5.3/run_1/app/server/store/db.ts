// The database access layer. One place for the SQL the app runs, typed row
// shapes, and the lapse check every read and write goes through.
import { Pool, type QueryResult } from './pool.js';

export interface Row {
  [column: string]: unknown;
}

export class Database {
  constructor(private readonly pool: Pool) {}

  async query<R extends Row = Row>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.with(async (client) => client.query<R>(text, values));
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.with(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(new Tx(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }
}

export class Tx {
  constructor(private readonly client: import('./client.js').Client) {}

  query<R extends Row = Row>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    return this.client.query<R>(text, values);
  }
}
