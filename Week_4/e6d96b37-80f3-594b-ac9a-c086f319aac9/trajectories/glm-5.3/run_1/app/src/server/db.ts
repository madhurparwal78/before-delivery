import pg from "pg";

const config = {
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/flan",
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const pool = new pg.Pool(config);

export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

export async function withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken
    }
    throw err;
  } finally {
    client.release();
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS namespaces (
  namespace TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS namespace_clocks (
  namespace TEXT PRIMARY KEY REFERENCES namespaces(namespace) ON DELETE CASCADE,
  offset_seconds BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS specimens (
  ns TEXT NOT NULL,
  key TEXT NOT NULL,
  display_label TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  holder_kind TEXT NOT NULL,
  holder_width_mm INT NOT NULL,
  holder_height_mm INT NOT NULL,
  attribution_reference TEXT NOT NULL DEFAULT '',
  attribution_mintmark TEXT NOT NULL DEFAULT '',
  attribution_revision INT NOT NULL DEFAULT 0,
  certainty TEXT NOT NULL DEFAULT 'uncertain',
  note TEXT NOT NULL DEFAULT '',
  correction TEXT NOT NULL DEFAULT '',
  register_state TEXT NOT NULL DEFAULT 'pending',
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  missing BOOLEAN NOT NULL DEFAULT FALSE,
  creation_sequence BIGSERIAL NOT NULL,
  created_event_at TIMESTAMPTZ,
  PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS photos (
  ns TEXT NOT NULL,
  id TEXT NOT NULL,
  specimen TEXT NOT NULL,
  label TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  offer TEXT,
  PRIMARY KEY (ns, id),
  UNIQUE (ns, specimen, label)
);
CREATE INDEX IF NOT EXISTS photos_specimen_idx ON photos (ns, specimen);

CREATE TABLE IF NOT EXISTS annotations (
  ns TEXT NOT NULL,
  id TEXT NOT NULL,
  specimen TEXT NOT NULL,
  photo TEXT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (ns, id)
);

CREATE TABLE IF NOT EXISTS tray_cells (
  ns TEXT NOT NULL,
  cell TEXT NOT NULL,
  specimen TEXT,
  audit_mark TEXT,
  audit_version INT NOT NULL DEFAULT 0,
  tray_version INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ns, cell)
);

CREATE TABLE IF NOT EXISTS tray_meta (
  ns TEXT PRIMARY KEY,
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS albums (
  ns TEXT PRIMARY KEY,
  set TEXT NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS album_holes (
  ns TEXT NOT NULL,
  hole TEXT NOT NULL,
  reference TEXT NOT NULL,
  mintmark TEXT NOT NULL,
  specimen TEXT,
  PRIMARY KEY (ns, hole)
);

CREATE TABLE IF NOT EXISTS keeper_orders (
  ns TEXT PRIMARY KEY,
  version INT NOT NULL DEFAULT 1,
  order_keys TEXT[] NOT NULL DEFAULT '{}',
  previous_order_keys TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS offers (
  ns TEXT NOT NULL,
  key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  dealer_items TEXT[] NOT NULL DEFAULT '{}',
  counterpart_items TEXT[] NOT NULL DEFAULT '{}',
  dealer_acceptance_version INT,
  counterpart_acceptance_version INT,
  dealer_acceptance_subject TEXT,
  counterpart_acceptance_subject TEXT,
  expires_at TIMESTAMPTZ,
  hold_grace_until TIMESTAMPTZ,
  PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS holds (
  ns TEXT NOT NULL,
  offer TEXT NOT NULL,
  specimen TEXT NOT NULL,
  PRIMARY KEY (ns, specimen)
);

CREATE TABLE IF NOT EXISTS manifests (
  ns TEXT NOT NULL,
  offer TEXT NOT NULL,
  party TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  order_keys TEXT[] NOT NULL DEFAULT '{}',
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (ns, offer, party)
);

CREATE TABLE IF NOT EXISTS receipts (
  ns TEXT NOT NULL,
  offer TEXT NOT NULL,
  party TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  matches BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (ns, offer, party)
);

CREATE TABLE IF NOT EXISTS disputes (
  ns TEXT NOT NULL,
  key TEXT NOT NULL,
  offer TEXT NOT NULL,
  specimen TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  open BOOLEAN NOT NULL DEFAULT TRUE,
  resolution_outcome TEXT,
  resolution_proposed_by TEXT,
  PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS dispute_markers (
  ns TEXT NOT NULL,
  dispute TEXT NOT NULL,
  key TEXT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (ns, dispute, key)
);

CREATE TABLE IF NOT EXISTS dispute_approvals (
  ns TEXT NOT NULL,
  dispute TEXT NOT NULL,
  party TEXT NOT NULL,
  PRIMARY KEY (ns, dispute, party)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  ns TEXT NOT NULL,
  dispute TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (ns, dispute, token)
);

CREATE TABLE IF NOT EXISTS events (
  ns TEXT NOT NULL,
  sequence BIGSERIAL NOT NULL,
  command_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ns, sequence)
);

CREATE TABLE IF NOT EXISTS audit_marks (
  ns TEXT NOT NULL,
  cell TEXT NOT NULL,
  sequence BIGSERIAL NOT NULL,
  command_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  mark TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ns, cell, sequence)
);

CREATE TABLE IF NOT EXISTS commands (
  ns TEXT NOT NULL,
  command_id TEXT NOT NULL,
  status INT NOT NULL,
  body JSONB NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ns, command_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  namespace TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  step_up_at TIMESTAMPTZ,
  step_up_by_subject TEXT
);

CREATE TABLE IF NOT EXISTS kc_state (
  state TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS register_records (
  ns TEXT NOT NULL,
  reference TEXT NOT NULL,
  issue TEXT NOT NULL,
  mintmark TEXT NOT NULL,
  revision INT NOT NULL,
  image_object_key TEXT,
  PRIMARY KEY (ns, reference)
);

CREATE TABLE IF NOT EXISTS seeded_workflows (
  ns TEXT NOT NULL,
  workflow TEXT NOT NULL,
  variant TEXT NOT NULL,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ns, workflow)
);

CREATE TABLE IF NOT EXISTS seeded_identities (
  ns TEXT NOT NULL,
  role TEXT NOT NULL,
  username TEXT NOT NULL,
  totp_secret TEXT,
  PRIMARY KEY (ns, role)
);
`;

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA_SQL);
  // fix a typo-proof: offers.version column
  await pool.query("ALTER TABLE offers ALTER COLUMN version SET NOT NULL");
}
