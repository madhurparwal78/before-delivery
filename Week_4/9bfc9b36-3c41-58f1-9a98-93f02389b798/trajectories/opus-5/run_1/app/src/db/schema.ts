/** The schema, applied exactly once per database under a database-wide lock. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS code_sequence (
  name text PRIMARY KEY,
  next_value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  keycloak_user_id text,
  seeded_password text,
  deleted boolean NOT NULL DEFAULT false,
  created_seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS account_email_key ON account (email);

CREATE TABLE IF NOT EXISTS cloth (
  code text PRIMARY KEY,
  name text NOT NULL,
  weight text NOT NULL,
  width_mm integer NOT NULL,
  usable_width_mm integer NOT NULL,
  rate_pence_per_m2 integer NOT NULL
);

CREATE TABLE IF NOT EXISTS closure (
  closed_on date PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS ruleset (
  version integer PRIMARY KEY,
  effective_at timestamptz NOT NULL,
  seam_overlap_mm integer NOT NULL,
  roach_permille integer NOT NULL,
  tolerance_mm integer NOT NULL,
  min_offcut_width_mm integer NOT NULL,
  min_offcut_length_mm integer NOT NULL,
  revision integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS boat (
  code text PRIMARY KEY,
  name text NOT NULL,
  class_name text NOT NULL,
  owner_email text NOT NULL,
  notes text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS measurement (
  id text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boat (code),
  dimension text NOT NULL,
  value_mm integer NOT NULL,
  measured_on date NOT NULL,
  source text NOT NULL,
  submission_id text,
  tolerance_mm integer NOT NULL DEFAULT 20,
  recorded_seq bigserial,
  photo_key text,
  photo_size integer,
  photo_sha256 text,
  photo_content_type text
);
CREATE INDEX IF NOT EXISTS measurement_boat ON measurement (boat_code, dimension, measured_on, recorded_seq);
CREATE UNIQUE INDEX IF NOT EXISTS measurement_submission ON measurement (submission_id) WHERE submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS submission (
  id text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boat (code),
  dimension text NOT NULL,
  value_mm integer NOT NULL,
  as_submitted text NOT NULL,
  measured_on date NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  reason text
);
CREATE INDEX IF NOT EXISTS submission_order ON submission (submitted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS drawing (
  code text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boat (code),
  sail text NOT NULL,
  cloth_code text NOT NULL REFERENCES cloth (code),
  status text NOT NULL,
  ruleset_version integer,
  assigned_to text,
  luff_mm integer,
  foot_mm integer,
  area_mm2 bigint,
  area_basis text,
  draw_boat_name text,
  draw_owner_name text,
  draw_dimensions jsonb,
  predecessor text,
  successor text,
  cut_sheet_sha256 text,
  cut_sheet_size integer,
  cut_sheet_key text,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS drawing_boat ON drawing (boat_code);
CREATE INDEX IF NOT EXISTS drawing_assigned ON drawing (assigned_to);

CREATE TABLE IF NOT EXISTS panel (
  drawing_code text NOT NULL REFERENCES drawing (code),
  number integer NOT NULL,
  outline jsonb NOT NULL,
  length_mm integer NOT NULL,
  width_mm integer NOT NULL,
  area_mm2 bigint NOT NULL,
  cut boolean NOT NULL DEFAULT false,
  PRIMARY KEY (drawing_code, number)
);

CREATE TABLE IF NOT EXISTS stock (
  code text PRIMARY KEY,
  kind text NOT NULL,
  cloth_code text NOT NULL REFERENCES cloth (code),
  lot text NOT NULL,
  width_mm integer NOT NULL,
  usable_width_mm integer NOT NULL,
  remaining_mm integer NOT NULL,
  on_hand_mm2 bigint NOT NULL,
  shelf_location text NOT NULL,
  note text NOT NULL DEFAULT '',
  last_counted_mm integer,
  last_counted_at timestamptz,
  revision integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS claim (
  id text PRIMARY KEY,
  stock_code text NOT NULL REFERENCES stock (code),
  drawing_code text NOT NULL REFERENCES drawing (code),
  holder_email text NOT NULL,
  length_mm integer NOT NULL,
  status text NOT NULL,
  taken_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  taken_seq bigserial
);
CREATE INDEX IF NOT EXISTS claim_stock ON claim (stock_code, status);
CREATE INDEX IF NOT EXISTS claim_drawing ON claim (drawing_code, taken_at, taken_seq);

CREATE TABLE IF NOT EXISTS lay (
  claim_id text NOT NULL REFERENCES claim (id),
  panel_number integer NOT NULL,
  x_mm integer NOT NULL,
  y_mm integer NOT NULL,
  rotation integer NOT NULL,
  laid_seq bigserial,
  PRIMARY KEY (claim_id, panel_number)
);

CREATE TABLE IF NOT EXISTS authority (
  id text PRIMARY KEY,
  loft_hand_email text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz
);

CREATE TABLE IF NOT EXISTS sight_grant (
  id text PRIMARY KEY,
  drawing_code text NOT NULL REFERENCES drawing (code),
  owner_email text NOT NULL,
  status text NOT NULL,
  granted_at timestamptz NOT NULL,
  ends_at timestamptz,
  withdrawn_at timestamptz
);
CREATE INDEX IF NOT EXISTS grant_owner ON sight_grant (owner_email);

CREATE TABLE IF NOT EXISTS account_entry (
  id text PRIMARY KEY,
  drawing_code text NOT NULL REFERENCES drawing (code),
  kind text NOT NULL,
  amount_pence integer NOT NULL,
  at timestamptz NOT NULL,
  note text,
  reason text,
  recorded_by text NOT NULL,
  entry_seq bigserial
);
CREATE INDEX IF NOT EXISTS account_entry_drawing ON account_entry (drawing_code, at DESC, entry_seq DESC);

CREATE TABLE IF NOT EXISTS ledger_line (
  line_id bigint PRIMARY KEY,
  pair_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  account text NOT NULL,
  amount_mm2 bigint NOT NULL,
  stock_code text NOT NULL,
  drawing_code text NOT NULL DEFAULT '',
  actor_email text NOT NULL,
  reason text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ledger_order ON ledger_line (posted_at DESC, line_id DESC);
CREATE INDEX IF NOT EXISTS ledger_stock ON ledger_line (stock_code, posted_at DESC, line_id DESC);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_line (account);

CREATE TABLE IF NOT EXISTS audit_trail (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_email text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  before_state text,
  after_state text,
  reason text,
  row_seq bigserial
);
CREATE INDEX IF NOT EXISTS audit_order ON audit_trail (at DESC, row_seq DESC);

CREATE TABLE IF NOT EXISTS owner_request_count (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  kind text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_request_window ON owner_request_count (account_email, kind, at);

CREATE TABLE IF NOT EXISTS app_session (
  id text PRIMARY KEY,
  account_email text NOT NULL,
  refresh_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL,
  key text NOT NULL,
  target text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  PRIMARY KEY (scope, key)
);

-- Each measurement keeps the tolerance that was current when it was recorded,
-- so a band it was judged against never changes under it.
ALTER TABLE measurement ADD COLUMN IF NOT EXISTS tolerance_mm integer NOT NULL DEFAULT 20;

-- The ledger and the audit trail are append-only at the database, for every
-- role, the app's own role included.
CREATE OR REPLACE FUNCTION refuse_rewrite() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_line_append_only ON ledger_line;
CREATE TRIGGER ledger_line_append_only
  BEFORE UPDATE OR DELETE ON ledger_line
  FOR EACH ROW EXECUTE FUNCTION refuse_rewrite();
ALTER TABLE ledger_line ENABLE ALWAYS TRIGGER ledger_line_append_only;

DROP TRIGGER IF EXISTS audit_trail_append_only ON audit_trail;
CREATE TRIGGER audit_trail_append_only
  BEFORE UPDATE OR DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION refuse_rewrite();
ALTER TABLE audit_trail ENABLE ALWAYS TRIGGER audit_trail_append_only;

DROP TRIGGER IF EXISTS ledger_line_append_only_stmt ON ledger_line;
CREATE TRIGGER ledger_line_append_only_stmt
  BEFORE TRUNCATE ON ledger_line
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_rewrite();
ALTER TABLE ledger_line ENABLE ALWAYS TRIGGER ledger_line_append_only_stmt;

DROP TRIGGER IF EXISTS audit_trail_append_only_stmt ON audit_trail;
CREATE TRIGGER audit_trail_append_only_stmt
  BEFORE TRUNCATE ON audit_trail
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_rewrite();
ALTER TABLE audit_trail ENABLE ALWAYS TRIGGER audit_trail_append_only_stmt;

-- Ids that end in a number compare by that number.
CREATE OR REPLACE FUNCTION code_number(code text) RETURNS bigint AS $$
  SELECT CASE WHEN code ~ '[0-9]+$' THEN (regexp_match(code, '([0-9]+)$'))[1]::bigint ELSE NULL END;
$$ LANGUAGE sql IMMUTABLE;
`;
