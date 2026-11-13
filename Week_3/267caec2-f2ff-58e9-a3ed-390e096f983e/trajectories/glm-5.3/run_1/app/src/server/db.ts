import pg from "pg";

// Dates travel as their `YYYY-MM-DD` strings; the domain layer formats them.
pg.types.setTypeParser(1082, (value: string) => value);


export type QueryResult<T extends pg.QueryResultRow> = pg.QueryResult<T>;
export type PoolClient = pg.PoolClient;
export type Queryable = Db | PoolClient;

export function newId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex.slice(0, 8)}${hex.slice(8, 12)}${hex.slice(12, 16)}${hex.slice(16, 20)}${hex.slice(20)}`;
}

export async function rows<T extends pg.QueryResultRow>(client: Queryable, text: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await (client as QueryableLike).query<T>(text, params as unknown[]);
  return result.rows;
}

interface QueryableLike {
  query<T extends pg.QueryResultRow>(text: string, params: unknown[]): Promise<pg.QueryResult<T>>;
}

export async function row<T extends pg.QueryResultRow>(client: Queryable, text: string, params: readonly unknown[] = []): Promise<T | null> {
  const found = await rows<T>(client, text, params);
  return found[0] ?? null;
}

export class Db {
  private readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 20 });
  }

  query<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as unknown[]);
  }

  async one<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T | null> {
    return row<T>(this, text, params);
  }

  async many<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    return rows<T>(this, text, params);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection already broken; the original error is what matters
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
