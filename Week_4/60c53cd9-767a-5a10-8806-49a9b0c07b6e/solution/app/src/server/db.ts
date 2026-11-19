/** Postgres: the pool, the transaction helper with deadlock retry, and the idempotent schema. */
import pg from "pg";

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}
export type Tx = pg.PoolClient;

// Dates cross the wire as app-clock instants; read timestamptz back as Date and bigint as number.
pg.types.setTypeParser(20, (value) => Number(value));

const SCHEMA_LOCK = 4_173_001;
export const INDEXER_LOCK = 4_173_002;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer', 'coordinator')),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  code text PRIMARY KEY,
  floor integer NOT NULL,
  stack text NOT NULL,
  band text NOT NULL,
  bedrooms integer NOT NULL,
  area_m2 integer NOT NULL,
  bearing integer NOT NULL,
  facing text NOT NULL,
  view_tag text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  price_version integer NOT NULL CHECK (price_version >= 1),
  released boolean NOT NULL,
  withdrawn boolean NOT NULL DEFAULT false,
  reserved boolean NOT NULL DEFAULT false,
  view_key text,
  view_size integer,
  view_checksum text
);
CREATE TABLE IF NOT EXISTS price_versions (
  unit_code text NOT NULL REFERENCES units (code),
  version integer NOT NULL,
  price integer NOT NULL,
  set_by uuid NOT NULL REFERENCES accounts (id),
  set_at timestamptz NOT NULL,
  PRIMARY KEY (unit_code, version)
);
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code text NOT NULL REFERENCES units (code),
  account_id uuid NOT NULL REFERENCES accounts (id),
  status text NOT NULL CHECK (status IN ('active', 'released', 'lapsed', 'converted')),
  ended_by text CHECK (ended_by IN ('buyer', 'withdrawal', 'lapse', 'conversion')),
  quoted_price integer NOT NULL,
  price_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  share_token text
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_per_unit ON holds (unit_code) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_per_account ON holds (account_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS holds_share_token ON holds (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS holds_active_end ON holds (ends_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS holds_account_unit ON holds (account_id, unit_code);
CREATE TABLE IF NOT EXISTS hold_attempts (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS hold_attempts_account_at ON hold_attempts (account_id, at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id uuid NOT NULL REFERENCES accounts (id),
  key text NOT NULL,
  request text NOT NULL,
  response_status integer NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS search_requests (
  id bigserial PRIMARY KEY,
  client text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS search_requests_client_at ON search_requests (client, at);
CREATE TABLE IF NOT EXISTS index_updates (
  id bigserial PRIMARY KEY,
  unit_code text NOT NULL REFERENCES units (code),
  created_at timestamptz NOT NULL,
  task_uid bigint,
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS index_updates_pending ON index_updates (unit_code) WHERE confirmed_at IS NULL;
`;

export class Database {
  readonly pool: pg.Pool;
  private readyFlag = false;

  constructor(private readonly url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    this.pool.on("error", () => undefined);
  }

  get ready(): boolean {
    return this.readyFlag;
  }

  markReady(): void {
    this.readyFlag = true;
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /** Runs `work` in one transaction, retrying when Postgres reports a deadlock or serialisation failure. */
  async tx<T>(work: (client: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if ((code === "40P01" || code === "40001") && attempt < 4) continue;
        throw error;
      } finally {
        client.release();
      }
    }
  }

  /** Creates the database when the role may, then applies the schema under an advisory lock. */
  async migrate(seed: (client: Tx) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
      try {
        await client.query("BEGIN");
        await client.query(SCHEMA);
        await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  /** Best effort: when the named database is missing, create it through the maintenance database. */
  async ensureDatabase(): Promise<void> {
    const target = new URL(this.url);
    const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
    const admin = new URL(this.url);
    admin.pathname = "/postgres";
    const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 3_000 });
    client.on("error", () => undefined);
    try {
      await client.connect();
      const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
