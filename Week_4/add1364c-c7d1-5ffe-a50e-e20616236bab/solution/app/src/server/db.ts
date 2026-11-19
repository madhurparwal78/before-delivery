import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1082, (value) => value);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 10_000 });
pool.on("error", () => undefined);

/**
 * pg-pool drops its error listener while a client is checked out, so a connection lost mid-transaction (a database
 * restart) would be an unhandled 'error' event and stop the process. The query in flight still rejects; the broken
 * client is discarded on release.
 */
async function checkout(): Promise<{ client: pg.PoolClient; release: () => void }> {
  const client = await pool.connect();
  let broken: Error | undefined;
  const onError = (error: Error): void => {
    broken = error;
  };
  client.on("error", onError);
  return {
    client,
    release: () => {
      client.removeListener("error", onError);
      client.release(broken);
    },
  };
}

export interface Db {
  query<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends object>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Tx extends Db {
  /** Runs after the transaction commits (events, external side effects). */
  after(callback: () => void | Promise<void>): void;
}

function wrap(runner: { query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult> }): Db {
  const query = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await runner.query(sql, params)).rows as T[];
  return {
    query,
    one: async <T extends object>(sql: string, params: unknown[] = []): Promise<T | null> =>
      (await query<T>(sql, params))[0] ?? null,
  };
}

/** A transaction owns one connection: queries issued together by Promise.all wait their turn. */
function oneAtATime(client: pg.PoolClient): { query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult> } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    query: (sql, params) => {
      const run = tail.then(() => client.query(sql, params));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

export const db: Db = wrap(pool);

const WRITE_LOCK = 7403;

/**
 * A read waits for every write already holding or queued on the write lock (a shared request queues behind them),
 * so an answer always includes the writes that started before the read arrived.
 */
export async function afterWrites(): Promise<void> {
  await pool.query("SELECT pg_advisory_xact_lock_shared($1)", [WRITE_LOCK]);
}

/** One writer at a time: audit seq order is commit order, and every uniqueness race has one winner. */
export async function write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const { client, release } = await checkout();
  const callbacks: Array<() => void | Promise<void>> = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const tx: Tx = { ...wrap(oneAtATime(client)), after: (callback) => void callbacks.push(callback) };
    const result = await work(tx);
    await client.query("COMMIT");
    release();
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        console.error("after-commit step failed:", error instanceof Error ? error.message : "unknown error");
      }
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    release();
    throw error;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, ord serial, full_name text NOT NULL, email text NOT NULL, handle text NOT NULL,
  role text NOT NULL, aliases text[] NOT NULL DEFAULT '{}', first_sign_in_at timestamptz,
  term_starts_on date, term_ends_on date, term_started boolean NOT NULL DEFAULT false, left_at timestamptz,
  seat text NOT NULL, seat_since timestamptz NOT NULL, seat_silent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS people_handle ON people (handle);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email));
CREATE TABLE IF NOT EXISTS person_vaults (person_id text NOT NULL, vault_id text NOT NULL, PRIMARY KEY (person_id, vault_id));
CREATE TABLE IF NOT EXISTS travel (
  id text PRIMARY KEY, person_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vaults (
  id text PRIMARY KEY, ord serial, name text NOT NULL, off_when_travelling boolean NOT NULL, formerly text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vaults_name ON vaults (lower(name));
CREATE TABLE IF NOT EXISTS vault_renames (
  id text PRIMARY KEY, vault_id text NOT NULL, old_name text NOT NULL, new_name text NOT NULL, by_name text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vendors (
  id text PRIMARY KEY, ord serial, name text NOT NULL, domain text NOT NULL UNIQUE, formerly text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vendor_renames (
  id text PRIMARY KEY, vendor_id text NOT NULL, old_name text NOT NULL, new_name text NOT NULL, by_name text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY, ord serial, vault_id text NOT NULL, min_length int NOT NULL, effective_on date NOT NULL,
  state text NOT NULL, version int NOT NULL, drafted_by text NOT NULL, signed_by text, took_force_on date,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_vault ON rules (vault_id);
CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY, ord serial, vault_id text NOT NULL, vendor_id text NOT NULL, label text NOT NULL,
  username text NOT NULL, secret_sealed text NOT NULL, secret_length int NOT NULL, secret_rev int NOT NULL DEFAULT 1,
  last_turned_on date NOT NULL, imported_on date, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_identity ON credentials (vault_id, vendor_id, lower(username));
CREATE TABLE IF NOT EXISTS holders (
  credential_id text NOT NULL, person_id text NOT NULL, ord serial, PRIMARY KEY (credential_id, person_id)
);
CREATE TABLE IF NOT EXISTS rotations (
  id text PRIMARY KEY, credential_id text NOT NULL UNIQUE, interval_days int NOT NULL, at_time text NOT NULL,
  first_run_on date NOT NULL, since timestamptz NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id text PRIMARY KEY, ord serial, credential_id text NOT NULL, kind text NOT NULL, rotation_id text, run_at timestamptz,
  run_date date, shifted boolean NOT NULL DEFAULT false, due_by date NOT NULL, state text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (rotation_id, run_at)
);
CREATE INDEX IF NOT EXISTS turns_credential ON turns (credential_id);
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY, ord serial, quarter_year int NOT NULL, quarter int NOT NULL, opened_on date NOT NULL,
  overdue_from date NOT NULL, status text NOT NULL, signed_off_by text, opened_at timestamptz NOT NULL,
  UNIQUE (quarter_year, quarter)
);
CREATE TABLE IF NOT EXISTS review_lines (
  id text PRIMARY KEY, review_id text NOT NULL, person_id text NOT NULL, vault_id text NOT NULL,
  decision text NOT NULL, decided_by text, decided_via text
);
CREATE INDEX IF NOT EXISTS review_lines_review ON review_lines (review_id);
CREATE TABLE IF NOT EXISTS audit (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, at timestamptz NOT NULL, office_day date NOT NULL,
  actor_person_id text, actor_name text NOT NULL, action text NOT NULL, subject_kind text NOT NULL,
  subject_id text NOT NULL, subject_name text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_day ON audit (office_day, seq);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, person_id text NOT NULL, started_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS sign_in_state (
  handle text PRIMARY KEY, failures int NOT NULL, window_started_at timestamptz NOT NULL, locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency (
  person_id text NOT NULL, endpoint text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status int NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (person_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY, filename text NOT NULL, by_person text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS import_rows (
  import_id text NOT NULL, row int NOT NULL, outcome text NOT NULL, reason text, parsed jsonb, names jsonb NOT NULL,
  credential_id text, PRIMARY KEY (import_id, row)
);
CREATE TABLE IF NOT EXISTS breach_checks (
  id text PRIMARY KEY, at timestamptz NOT NULL, ok boolean NOT NULL, office_day date NOT NULL, counts jsonb,
  healths jsonb, exposed jsonb, domains jsonb
);
`;

export async function migrate(): Promise<void> {
  const { client, release } = await checkout();
  try {
    await client.query("SELECT pg_advisory_lock(7404)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(7404)");
  } finally {
    release();
  }
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
