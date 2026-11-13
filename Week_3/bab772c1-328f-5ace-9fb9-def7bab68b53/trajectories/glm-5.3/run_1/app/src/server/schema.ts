// Idempotent schema applied on every start.

import { query } from "./db.js";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  epoch_utc TEXT NOT NULL,
  epoch_ms BIGINT NOT NULL,
  distance_unit TEXT NOT NULL DEFAULT 'km',
  speed_unit TEXT NOT NULL DEFAULT 'm_s',
  reference_target TEXT,
  reference_state TEXT,
  reference_etag TEXT,
  reference_fetched_at TEXT,
  reference_vector_count INT,
  change_version BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  audit_seq BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passes (
  id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  state TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  transcript_line_count INT NOT NULL DEFAULT 0,
  rejected_line INT,
  rejected_reason TEXT,
  upload_order BIGINT NOT NULL,
  created_at TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS passes_mission_idx ON passes (mission_id, upload_order);

CREATE TABLE IF NOT EXISTS samples (
  pass_id UUID NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL,
  seq INT NOT NULL,
  utc_ms BIGINT NOT NULL,
  met BIGINT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  vx DOUBLE PRECISION NOT NULL,
  vy DOUBLE PRECISION NOT NULL,
  vz DOUBLE PRECISION NOT NULL,
  lat_deg DOUBLE PRECISION NOT NULL,
  lon_deg DOUBLE PRECISION NOT NULL,
  altitude_m DOUBLE PRECISION NOT NULL,
  speed_m_s DOUBLE PRECISION NOT NULL,
  residual_m DOUBLE PRECISION,
  PRIMARY KEY (pass_id, seq)
);
CREATE INDEX IF NOT EXISTS samples_mission_idx ON samples (mission_id, met, pass_id, seq);

CREATE TABLE IF NOT EXISTS transcript_lines (
  id UUID PRIMARY KEY,
  pass_id UUID NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL,
  seq INT NOT NULL,
  utc_ms BIGINT NOT NULL,
  met BIGINT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lines_mission_idx ON transcript_lines (mission_id, met, pass_id, seq);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  pass_id UUID NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  met BIGINT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sample_met BIGINT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_mission_idx ON events (mission_id, met);

CREATE TABLE IF NOT EXISTS landmarks (
  id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  caseless_key TEXT NOT NULL,
  lat_deg DOUBLE PRECISION NOT NULL,
  lon_deg DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL,
  order_n BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS landmarks_mission_idx ON landmarks (mission_id, order_n);
CREATE UNIQUE INDEX IF NOT EXISTS landmarks_caseless_idx ON landmarks (mission_id, caseless_key);

CREATE TABLE IF NOT EXISTS reference_vectors (
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  unix_ms BIGINT NOT NULL,
  x_m DOUBLE PRECISION NOT NULL,
  y_m DOUBLE PRECISION NOT NULL,
  z_m DOUBLE PRECISION NOT NULL,
  vx_m_s DOUBLE PRECISION NOT NULL,
  vy_m_s DOUBLE PRECISION NOT NULL,
  vz_m_s DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (mission_id, unix_ms)
);

CREATE TABLE IF NOT EXISTS request_keys (
  key TEXT NOT NULL,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  state TEXT NOT NULL,
  fingerprint TEXT,
  status INT,
  pass_id UUID,
  event_id UUID,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, mission_id, route)
);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_utc TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS share_links_mission_idx ON share_links (mission_id);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  order_n BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS subscribers_mission_idx ON subscribers (mission_id, order_n);

CREATE TABLE IF NOT EXISTS plan_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plan TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  prev TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (mission_id, seq)
);

CREATE TABLE IF NOT EXISTS pending_search_writes (
  id BIGSERIAL PRIMARY KEY,
  mission_id UUID NOT NULL,
  kind TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_writes_idx ON pending_search_writes (created_at);

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  pass_id UUID,
  event_id TEXT,
  payload JSONB,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_unsent_idx ON outbox (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS change_notices (
  id BIGSERIAL PRIMARY KEY,
  mission_id UUID NOT NULL,
  version BIGINT NOT NULL,
  notice TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS change_notices_idx ON change_notices (id);

CREATE TABLE IF NOT EXISTS mission_streams (
  id BIGSERIAL PRIMARY KEY,
  mission_id UUID NOT NULL,
  stream_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  token TEXT
);
CREATE INDEX IF NOT EXISTS mission_streams_mission_idx ON mission_streams (mission_id);

CREATE TABLE IF NOT EXISTS fetch_locks (
  mission_id UUID PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at BIGINT NOT NULL
);
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA);
}
