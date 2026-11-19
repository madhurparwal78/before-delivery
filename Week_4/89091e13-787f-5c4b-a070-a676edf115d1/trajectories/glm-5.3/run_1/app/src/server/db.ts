// Typed database access. Every query lives here as a named function so the
// server code reads like the domain it serves.

import pg from "pg";

export type QueryResult<T extends pg.QueryResultRow> = pg.QueryResult<T>;

// bigint columns parse as BigInt; SUM(bigint) returns numeric, which also parses
// as BigInt so aggregates never arrive as strings.
pg.types.setTypeParser(20, (value: string) => BigInt(value));
pg.types.setTypeParser(1700, (value: string) => {
  const [whole, decimal = ""] = value.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const abs = whole.replace("-", "");
  if (decimal === "") return sign * BigInt(abs === "" ? "0" : abs);
  const padded = (decimal + "000000").slice(0, 6);
  return sign * (BigInt(abs === "" ? "0" : abs) * 1_000_000n + BigInt(padded));
});

export class Db {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
    });
  }

  async query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as never[]);
  }

  async one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async many<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  async transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const wrapped = new DbClient(client);
      const result = await work(wrapped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class DbClient {
  constructor(private client: pg.PoolClient) {}

  async query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.client.query<T>(text, params as never[]);
  }

  async one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async many<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }
}

export type DbLike = Db | DbClient;
