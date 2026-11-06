import { Pool, type PoolClient, type QueryResult } from "pg";
import pg from "pg";

// DATE columns arrive as plain YYYY-MM-DD strings, not JS Date objects.
pg.types.setTypeParser(1082, (value: string) => value);

export interface Row {
  [column: string]: unknown;
}

export class Db {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const result: QueryResult = await this.pool.query(sql, params as never[]);
    return result.rows;
  }

  /** Run fn inside a transaction; rolls back on any throw. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
