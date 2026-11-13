import pg from "pg";
import { config } from "./config";
import { ApiError } from "./errors";
import { SCHEMA } from "./schema";

pg.types.setTypeParser(1082, (value: string) => value);

const SCHEMA_LOCK = 4_173_001;
const RETRY_MS = 2000;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 2000 });
pool.on("error", () => undefined);

let schemaReady = false;

/** Applies the schema idempotently; retries every few seconds until Postgres answers. */
export async function migrateUntilReady(): Promise<void> {
  while (!schemaReady) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
        schemaReady = true;
      } finally {
        client.release();
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

function unavailable(error: unknown): ApiError | null {
  if (!schemaReady) return new ApiError("STORAGE_UNAVAILABLE");
  const code = (error as { code?: string }).code ?? "";
  const connection = /^(08|57P|53|ECONN|ETIMEDOUT|ENOTFOUND|EPIPE)/.test(code) || /timeout|terminated|Connection/i.test(String(error));
  return connection ? new ApiError("STORAGE_UNAVAILABLE") : null;
}

export async function query<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<Row[]> {
  if (!schemaReady) throw new ApiError("STORAGE_UNAVAILABLE");
  try {
    return (await pool.query<Row>(text, params)).rows;
  } catch (error) {
    throw unavailable(error) ?? error;
  }
}

/** The one row a statement always produces: an INSERT ... RETURNING, or an UPDATE of a row that was just locked. */
export function only<Row>(rows: readonly Row[]): Row {
  const [row] = rows;
  if (row === undefined) throw new Error("the statement returned no row");
  return row;
}

export async function queryOne<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await query<Row>(text, params))[0];
}

export type Tx = <Row extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<Row[]>;

/** Runs the work in one transaction; the callback's `tx` is the only handle on that transaction. */
export async function transaction<Result>(work: (tx: Tx) => Promise<Result>): Promise<Result> {
  if (!schemaReady) throw new ApiError("STORAGE_UNAVAILABLE");
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw unavailable(error) ?? error;
  }
  try {
    await client.query("BEGIN");
    const result = await work(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw unavailable(error) ?? error;
  } finally {
    client.release();
  }
}

/** True when the schema is applied and Postgres answers: the state in which the API can serve. */
export async function postgresReachable(): Promise<boolean> {
  if (!schemaReady) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export function isUniqueViolation(error: unknown): error is { constraint: string } {
  return (error as { code?: string }).code === "23505";
}
