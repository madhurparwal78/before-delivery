import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { config } from './config.js';

// The money rules live in the schema: a running balance never below zero, one charge and at most one refund per
// generation, one seat per member, one idempotency key per workspace, case-insensitive unique emails and names.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('free', 'standard', 'pro', 'max', 'team')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  session_hashes text[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_session_idx ON users USING gin (session_hashes);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_name_key ON projects (workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  project_id uuid NOT NULL REFERENCES projects (id),
  user_id uuid NOT NULL REFERENCES users (id),
  model text NOT NULL CHECK (model IN ('vela-4.5', 'vela-4-turbo', 'vela-image-4')),
  prompt text NOT NULL,
  duration integer CHECK (duration IN (5, 10)),
  image_count integer CHECK (image_count BETWEEN 1 AND 4),
  aspect text NOT NULL CHECK (aspect IN ('16:9', '9:16', '1:1')),
  cost integer NOT NULL CHECK (cost > 0),
  status text NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'cancelled')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CHECK ((duration IS NULL) <> (image_count IS NULL)),
  CHECK ((finished_at IS NOT NULL) = (status IN ('ready', 'cancelled')))
);
CREATE UNIQUE INDEX IF NOT EXISTS generations_idempotency_key ON generations (workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS generations_project_idx ON generations (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_open_idx ON generations (status) WHERE status IN ('queued', 'rendering');
CREATE TABLE IF NOT EXISTS credit_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  kind text NOT NULL CHECK (kind IN ('plan', 'seat', 'charge', 'refund')),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  user_id uuid NOT NULL REFERENCES users (id),
  generation_id uuid REFERENCES generations (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((generation_id IS NULL) = (kind IN ('plan', 'seat'))),
  CHECK (CASE kind WHEN 'charge' THEN amount < 0 ELSE amount > 0 END)
);
CREATE INDEX IF NOT EXISTS credit_entries_workspace_idx ON credit_entries (workspace_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS credit_entries_one_charge ON credit_entries (generation_id) WHERE kind = 'charge';
CREATE UNIQUE INDEX IF NOT EXISTS credit_entries_one_refund ON credit_entries (generation_id) WHERE kind = 'refund';
CREATE UNIQUE INDEX IF NOT EXISTS credit_entries_one_seat ON credit_entries (user_id) WHERE kind = 'seat';
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_key ON invitations (workspace_id, lower(email)) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('contact', 'licensing')),
  first_name text,
  last_name text,
  full_name text,
  email text NOT NULL,
  company text NOT NULL,
  company_size text NOT NULL,
  industry text NOT NULL,
  products jsonb,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Serialises schema setup and seeding when several copies of the app start against one database. */
const SETUP_LOCK = 4_173_001;

export type Client = pg.PoolClient;

/** Anything that runs a query: the pool, or one transaction's client. */
export interface Queryable {
  query<Row extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<pg.QueryResult<Row>>;
}

@Injectable()
export class Database implements OnApplicationShutdown {
  // The server may end an idle connection (a restart, an administrator); the pool drops it and opens a new one.
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 })
    .on('error', (error) => console.error(`database connection lost: ${error.message}`));

  query<Row extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<Row>> {
    return this.pool.query<Row>(sql, params);
  }

  /** Runs `work` in one transaction: all of its writes land together or not at all. */
  async transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // A connection the server ended cannot roll back; it is discarded rather than returned to the pool.
      await client.query('ROLLBACK').catch((rollbackError: Error) => (broken = rollbackError));
      throw error;
    } finally {
      client.release(broken);
    }
  }

  /** Locks the workspace row: credit changes, starts and project creates for one workspace run one after another. */
  async lockWorkspace(client: Client, workspaceId: string): Promise<void> {
    await client.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
  }

  async setUp(seed: (client: Client) => Promise<void>): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
      await client.query(SCHEMA);
      await seed(client);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Postgres raises 23505 when a unique index refuses a row. */
export function isUniqueViolation(error: unknown, index: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === index;
}
