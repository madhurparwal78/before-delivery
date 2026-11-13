import { Pool, type PoolClient } from 'pg';

/**
 * Postgres access through the `pg` driver, exposed as a tagged-template query
 * interface so every call site reads as plain SQL with bound parameters.
 *
 * Transactions run on one client with BEGIN/COMMIT, so each write that must
 * be serialised against a simultaneous write is one atomic step.
 */

export interface Row {
  readonly [column: string]: unknown;
}

/** A query answer: awaited as its rows, with `rows` and `length` on the result. */
export type Answer = Promise<readonly Row[] & { rows: readonly Row[]; length: number }>;

/** A transaction's executor; the same tagged-template interface as the pool. */
export type Executor = (strings: TemplateStringsArray, ...values: readonly unknown[]) => Answer;

export interface Db {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): Answer;
  /** Runs a whole write inside one BEGIN … COMMIT on one client. */
  begin: <T>(work: (tx: Executor) => Promise<T>) => Promise<T>;
  /** Runs a plain SQL string with optional parameters. */
  unsafe: (sql: string, values?: readonly unknown[]) => Promise<readonly Row[] & { rows: readonly Row[]; length: number }>;
  end: () => Promise<void>;
}

/** Builds a query with $1, $2 … placeholders from a tagged template. */
function build(strings: TemplateStringsArray, values: readonly unknown[]): { text: string; values: readonly unknown[] } {
  let text = '';
  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];
    if (index < values.length) text += `$${index + 1}`;
  }
  return { text, values };
}

/** Wraps a pg answer so awaiting it yields the rows, with `rows` and `length`. */
async function wrap(raw: Promise<{ rows: unknown[] }>): Promise<readonly Row[] & { rows: readonly Row[]; length: number }> {
  const result = await raw;
  const rows = Object.assign([...result.rows], { rows: result.rows, length: result.rows.length });
  return rows as readonly Row[] & { rows: readonly Row[]; length: number };
}

export function connectDatabase(url: string): Db {
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 60_000 });

  const queryPool = (strings: TemplateStringsArray, values: readonly unknown[]): Answer => {
    const { text, values: bound } = build(strings, values);
    return wrap(pool.query(text, bound.slice()));
  };

  const db = ((strings: TemplateStringsArray, ...values: readonly unknown[]) => queryPool(strings, values)) as Db;

  db.begin = <T>(work: (tx: Executor) => Promise<T>): Promise<T> =>
    (async () => {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Executor = (strings, ...values) => {
          const { text, values: bound } = build(strings, values);
          return wrap(client.query(text, bound.slice()));
        };
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })();

  db.unsafe = async (sql: string, values?: readonly unknown[]) => {
    const raw = (await pool.query(sql, values === undefined ? [] : values.slice())) as unknown;
    // A multi-statement script answers an array of results; one statement a single result.
    const rowsSource = Array.isArray(raw) ? (raw as { rows: Record<string, unknown>[] }[]).flatMap((part) => part.rows) : ((raw as { rows: Record<string, unknown>[] }).rows ?? []);
    const rows = Object.assign([...rowsSource], { rows: rowsSource, length: rowsSource.length });
    return rows as readonly Row[] & { rows: readonly Row[]; length: number };
  };

  db.end = async () => {
    await pool.end();
  };

  return db;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS hiker (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  display_name TEXT NOT NULL,
  passphrase_hash TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g','oz','lb')),
  goal_grams INTEGER NOT NULL CHECK (goal_grams BETWEEN 1 AND 50000),
  time_zone TEXT NOT NULL,
  paper_size TEXT NOT NULL CHECK (paper_size IN ('A4','Letter'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS closet_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  weight_grams INTEGER NOT NULL CHECK (weight_grams BETWEEN 0 AND 50000),
  units_owned INTEGER NOT NULL CHECK (units_owned BETWEEN 0 AND 99),
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  price_cents INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  photo_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES closet_items(id) ON DELETE CASCADE,
  extension TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('planning','packed','walked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES closet_items(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('base','worn','consumable')),
  name TEXT NOT NULL,
  unit_weight_grams INTEGER NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (list_id, item_id)
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pack_sheets (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  paper_size TEXT NOT NULL,
  content_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed','committed')),
  counts_matched INTEGER NOT NULL DEFAULT 0,
  counts_created INTEGER NOT NULL DEFAULT 0,
  counts_rejected INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_rows (
  import_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  row INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('matched','created','rejected')),
  item_id TEXT,
  same_as_row INTEGER,
  reason TEXT,
  PRIMARY KEY (import_id, row)
);
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id TEXT PRIMARY KEY,
  op JSONB NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retirement_keys (
  key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  request_body JSONB NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS closet_identity ON closet_items (category, lower(regexp_replace(trim(name), '\\s+', ' ', 'g')));
`;

/** Applies the schema; safe to run on every start against an existing database. */
export async function applySchema(db: Db): Promise<void> {
  await db.unsafe(SCHEMA);
}
