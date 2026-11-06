import pg from "pg";

export type Queryable = Pick<pg.PoolClient, "query">;
export type Row = Record<string, unknown>;

// Timestamps come back as epoch milliseconds so no layer parses or formats a date by accident.
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/;

function parseTimestamp(text: string): number {
  const match = TIMESTAMP.exec(text);
  if (!match) throw new TypeError("unexpected timestamp text");
  const fraction = (match[3] ?? "").padEnd(3, "0").slice(0, 3);
  return Date.parse(`${match[1]}T${match[2]}.${fraction}${match[4]}:${match[5] ?? "00"}`);
}

pg.types.setTypeParser(1184, parseTimestamp);
// dates stay plain YYYY-MM-DD text
pg.types.setTypeParser(1082, (text: string) => text);
pg.types.setTypeParser(20, (text: string) => Number(text));

let pool: pg.Pool | null = null;

export function openPool(connectionString: string): void {
  pool = new pg.Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000, options: "-c TimeZone=UTC" });
  pool.on("error", () => undefined);
}

export function database(): pg.Pool {
  if (!pool) throw new Error("database pool is not open");
  return pool;
}

export async function withTransaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
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

/** Serialises everything that stores computations or moves a restatement into or out of publication. */
export async function lockLedger(tx: Queryable): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(7340101)");
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function one(tx: Queryable, sql: string, params: unknown[] = []): Promise<Row | null> {
  const result = await tx.query<Row>(sql, params);
  return result.rows[0] ?? null;
}

export async function many(tx: Queryable, sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await tx.query<Row>(sql, params);
  return result.rows;
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new TypeError(`column ${key} is not text`);
  return value;
}

export function textOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function numberValue(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new TypeError(`column ${key} is not a number`);
  return value;
}

export function numberOrNull(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

export function toTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
