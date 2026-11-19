import pg from 'pg';
import { limits, providers } from '../config.ts';
import { serviceUnavailable } from '../http/errors.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS namespaces (
  ns              text PRIMARY KEY,
  clock_mode      text NOT NULL,
  clock_base      timestamptz NOT NULL,
  advanced_s      bigint NOT NULL DEFAULT 0,
  next_sequence   bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS specimens (
  ns            text NOT NULL REFERENCES namespaces(ns) ON DELETE CASCADE,
  key           text NOT NULL,
  display_label text NOT NULL,
  owner         text NOT NULL,
  status        text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  holder        jsonb NOT NULL,
  attribution   jsonb NOT NULL,
  quarantined   boolean NOT NULL DEFAULT false,
  missing       boolean NOT NULL DEFAULT false,
  created_seq   bigint NOT NULL,
  PRIMARY KEY (ns, key)
);
CREATE INDEX IF NOT EXISTS specimens_seq ON specimens (ns, created_seq);

CREATE TABLE IF NOT EXISTS photos (
  ns          text NOT NULL,
  id          text NOT NULL,
  specimen    text NOT NULL,
  label       text NOT NULL,
  object_key  text NOT NULL,
  sha256      text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  content_type text NOT NULL,
  created_seq bigint NOT NULL,
  PRIMARY KEY (ns, id)
);
CREATE INDEX IF NOT EXISTS photos_specimen ON photos (ns, specimen);

CREATE TABLE IF NOT EXISTS annotations (
  ns        text NOT NULL,
  id        text NOT NULL,
  specimen  text NOT NULL,
  photo     text NOT NULL,
  x         integer NOT NULL,
  y         integer NOT NULL,
  text      text NOT NULL,
  PRIMARY KEY (ns, id)
);
CREATE INDEX IF NOT EXISTS annotations_specimen ON annotations (ns, specimen);

CREATE TABLE IF NOT EXISTS register_records (
  ns        text NOT NULL,
  reference text NOT NULL,
  revision  integer NOT NULL,
  issue     text NOT NULL,
  mintmark  text NOT NULL,
  image_key text NOT NULL,
  PRIMARY KEY (ns, reference, revision)
);

CREATE TABLE IF NOT EXISTS trays (
  ns      text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tray_cells (
  ns            text NOT NULL,
  cell          text NOT NULL,
  specimen      text,
  audit_mark    text,
  audit_version integer NOT NULL DEFAULT 0,
  row_index     integer NOT NULL,
  col_index     integer NOT NULL,
  width_mm      integer NOT NULL,
  height_mm     integer NOT NULL,
  PRIMARY KEY (ns, cell)
);

CREATE TABLE IF NOT EXISTS albums (
  ns       text PRIMARY KEY,
  set_key  text,
  revision integer,
  version  integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS album_holes (
  ns        text NOT NULL,
  label     text NOT NULL,
  reference text NOT NULL,
  mintmark  text NOT NULL,
  specimen  text,
  position  integer NOT NULL,
  PRIMARY KEY (ns, label)
);

CREATE TABLE IF NOT EXISTS keeper_orders (
  ns       text PRIMARY KEY,
  ordering jsonb NOT NULL,
  previous jsonb,
  version  integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS offers (
  ns                text NOT NULL,
  key               text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  status            text NOT NULL,
  dealer_items      jsonb NOT NULL DEFAULT '[]',
  counterpart_items jsonb NOT NULL DEFAULT '[]',
  accept_dealer     integer,
  accept_counterpart integer,
  expires_at        timestamptz,
  created_seq       bigint NOT NULL,
  PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS offer_holds (
  ns        text NOT NULL,
  offer     text NOT NULL,
  specimen  text NOT NULL,
  party     text NOT NULL,
  placed_at timestamptz NOT NULL,
  release_after timestamptz,
  PRIMARY KEY (ns, offer, specimen)
);

CREATE TABLE IF NOT EXISTS manifests (
  ns       text NOT NULL,
  offer    text NOT NULL,
  party    text NOT NULL,
  version  integer NOT NULL DEFAULT 1,
  ordering jsonb NOT NULL DEFAULT '[]',
  frozen   boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (ns, offer, party)
);

CREATE TABLE IF NOT EXISTS receipts (
  ns        text NOT NULL,
  offer     text NOT NULL,
  party     text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  matches   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (ns, offer, party)
);

CREATE TABLE IF NOT EXISTS disputes (
  ns        text NOT NULL,
  key       text NOT NULL,
  offer     text NOT NULL,
  specimen  text NOT NULL,
  version   integer NOT NULL DEFAULT 1,
  open      boolean NOT NULL DEFAULT true,
  note      text NOT NULL DEFAULT '',
  outcome   text,
  proposed_by text,
  approvals jsonb NOT NULL DEFAULT '[]',
  created_seq bigint NOT NULL,
  PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS dispute_markers (
  ns       text NOT NULL,
  id       text NOT NULL,
  dispute  text NOT NULL,
  x        integer NOT NULL,
  y        integer NOT NULL,
  text     text NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (ns, id)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  ns         text NOT NULL,
  token      text NOT NULL,
  dispute    text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (ns, token)
);
CREATE INDEX IF NOT EXISTS evidence_links_token ON evidence_links (token);

CREATE TABLE IF NOT EXISTS desk_events (
  ns         text NOT NULL,
  sequence   bigint NOT NULL,
  command_id text,
  actor      text NOT NULL,
  type       text NOT NULL,
  at         timestamptz NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (ns, sequence)
);

CREATE TABLE IF NOT EXISTS audit_marks (
  ns         text NOT NULL,
  sequence   bigint NOT NULL,
  cell       text NOT NULL,
  mark       text NOT NULL,
  actor      text NOT NULL,
  command_id text NOT NULL,
  PRIMARY KEY (ns, sequence)
);

CREATE TABLE IF NOT EXISTS command_replies (
  ns          text NOT NULL,
  command_id  text NOT NULL,
  subject     text NOT NULL,
  fingerprint text NOT NULL,
  status      integer NOT NULL,
  body        jsonb NOT NULL,
  PRIMARY KEY (ns, command_id)
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id            text PRIMARY KEY,
  ns            text NOT NULL,
  subject       text NOT NULL,
  username      text NOT NULL,
  role          text NOT NULL,
  kc_session    text,
  refresh_token text,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  step_up_at    timestamptz,
  bypass_keycloak boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS app_sessions_subject ON app_sessions (subject);

CREATE TABLE IF NOT EXISTS auth_flows (
  state      text PRIMARY KEY,
  ns         text NOT NULL,
  return_to  text NOT NULL,
  step_up    boolean NOT NULL DEFAULT false,
  verifier   text NOT NULL,
  session_id text,
  created_at timestamptz NOT NULL
);
`;

export type Sql = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;
let schemaReady = false;

function makePool(): pg.Pool {
  const created = new pg.Pool({
    connectionString: providers.databaseUrl,
    max: 12,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: limits.providerTimeoutMs,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    // A closed stream must release its database work at once.
    allowExitOnIdle: false,
  });
  created.on('error', () => {
    // A broken idle connection is dropped by the pool; the next request retries.
  });
  return created;
}

export function rawPool(): pg.Pool {
  if (!pool) pool = makePool();
  return pool;
}

/**
 * The schema is applied idempotently. When Postgres is unreachable at boot the
 * server still serves health, and the next request that needs it retries here.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await rawPool().query(SCHEMA);
  schemaReady = true;
}

/** Any Postgres failure surfaces as the published 503. */
export async function db(): Promise<pg.Pool> {
  try {
    await ensureSchema();
  } catch {
    schemaReady = false;
    throw serviceUnavailable();
  }
  return rawPool();
}

/** Runs `work` in one transaction, so a rejected command commits nothing. */
export async function tx<T>(work: (sql: pg.PoolClient) => Promise<T>): Promise<T> {
  const active = await db();
  let client: pg.PoolClient;
  try {
    client = await active.connect();
  } catch {
    throw serviceUnavailable();
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already gone; releasing it below is enough.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = null;
    schemaReady = false;
    await closing.end();
  }
}
