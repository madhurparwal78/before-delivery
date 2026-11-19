import pg from "pg";
import { SCHEMA, SCHEMA_LOCK_KEY } from "./schema.ts";

pg.types.setTypeParser(1700, (value) => Number(value));
pg.types.setTypeParser(20, (value) => Number(value));

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>>;
}

export class Database {
  private pool: pg.Pool | null = null;
  private readonly url: string;
  private ready = false;

  constructor(url: string) {
    this.url = url;
  }

  isReady(): boolean {
    return this.ready;
  }

  async connectUntilReady(): Promise<void> {
    for (;;) {
      try {
        const pool = new pg.Pool({ connectionString: this.url, max: 20, connectionTimeoutMillis: 3000 });
        pool.on("error", () => undefined);
        const client = await pool.connect();
        try {
          await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
          await client.query(SCHEMA);
          await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
        } finally {
          client.release();
        }
        this.pool = pool;
        this.ready = true;
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private connection(): pg.Pool {
    if (!this.pool) throw new Error("database is not ready");
    return this.pool;
  }

  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<Row>> {
    return this.connection().query<Row>(text, values);
  }

  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.connection().connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function rows<Row extends pg.QueryResultRow>(client: Queryable, text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await client.query<Row>(text, values);
  return result.rows;
}
