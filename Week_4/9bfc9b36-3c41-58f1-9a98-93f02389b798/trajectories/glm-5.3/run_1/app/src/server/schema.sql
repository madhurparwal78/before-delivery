-- Boltrope schema. Applied once per database, under the boot advisory lock.

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email_norm text UNIQUE NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('sailmaker','loft-hand','yacht-owner')),
  kc_user_id text,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cloths (
  code text PRIMARY KEY,
  name text NOT NULL,
  weight text NOT NULL,
  width_mm integer NOT NULL,
  usable_width_mm integer NOT NULL,
  rate_pence_per_m2 integer NOT NULL
);

CREATE TABLE IF NOT EXISTS closures (
  date date PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS rulesets (
  version integer PRIMARY KEY,
  effective_at timestamptz NOT NULL,
  seam_overlap_mm integer NOT NULL,
  roach_permille integer NOT NULL,
  tolerance_mm integer NOT NULL,
  min_offcut_width_mm integer NOT NULL,
  min_offcut_length_mm integer NOT NULL,
  revision integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS boats (
  code text PRIMARY KEY,
  name text NOT NULL,
  class_name text NOT NULL,
  owner_id text NOT NULL REFERENCES accounts(id),
  notes text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS measurements (
  id text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boats(code),
  dimension text NOT NULL CHECK (dimension IN ('I','J','P','E','LL','LP')),
  value_mm integer NOT NULL,
  measured_on date NOT NULL,
  source text NOT NULL CHECK (source IN ('sailmaker','submission')),
  submission_id text,
  photo_key text,
  photo_size integer,
  photo_sha256 text,
  photo_content_type text,
  recorded_at timestamptz NOT NULL,
  ord integer NOT NULL
);
CREATE INDEX IF NOT EXISTS measurements_boat_idx ON measurements(boat_code, dimension, ord);

CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boats(code),
  dimension text NOT NULL,
  value_mm integer NOT NULL,
  as_submitted text NOT NULL,
  measured_on date NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending','accepted','rejected','reversed')),
  submitted_by text NOT NULL REFERENCES accounts(id),
  submitted_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  reason text,
  measurement_id text
);

CREATE TABLE IF NOT EXISTS drawings (
  code text PRIMARY KEY,
  boat_code text NOT NULL REFERENCES boats(code),
  sail text NOT NULL CHECK (sail IN ('mainsail','headsail')),
  cloth_code text NOT NULL REFERENCES cloths(code),
  status text NOT NULL CHECK (status IN ('measuring','remeasure','drawn','nested','cutting','cut','pending_store','issued')),
  ruleset_version integer,
  assigned_to text REFERENCES accounts(id),
  luff_mm integer,
  foot_mm integer,
  area_mm2 integer,
  draw_boat_name text,
  draw_owner_name text,
  draw_dims jsonb,
  panels jsonb,
  predecessor text,
  successor text,
  cut_sheet_sha256 text,
  cut_sheet_size integer,
  cut_sheet_key text,
  cut_sheet_superseded_by text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS drawings_boat_idx ON drawings(boat_code);

CREATE TABLE IF NOT EXISTS stock (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('roll','offcut')),
  cloth_code text NOT NULL REFERENCES cloths(code),
  lot text NOT NULL,
  width_mm integer NOT NULL,
  usable_width_mm integer NOT NULL,
  remaining_mm integer NOT NULL,
  on_hand_mm2 bigint NOT NULL,
  shelf_location text NOT NULL,
  note text NOT NULL DEFAULT '',
  last_counted_mm integer,
  last_counted_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id text PRIMARY KEY,
  stock_code text NOT NULL REFERENCES stock(code),
  drawing_code text NOT NULL REFERENCES drawings(code),
  holder_id text NOT NULL REFERENCES accounts(id),
  length_mm integer NOT NULL,
  status text NOT NULL CHECK (status IN ('held','cut','lapsed','released')),
  taken_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  cut_at timestamptz
);
CREATE INDEX IF NOT EXISTS claims_stock_idx ON claims(stock_code);

CREATE TABLE IF NOT EXISTS lays (
  claim_id text NOT NULL REFERENCES claims(id),
  panel_number integer NOT NULL,
  x_mm integer NOT NULL,
  y_mm integer NOT NULL,
  rotation integer NOT NULL CHECK (rotation IN (0,180)),
  PRIMARY KEY (claim_id, panel_number)
);

CREATE TABLE IF NOT EXISTS authorities (
  id text PRIMARY KEY,
  loft_hand_id text NOT NULL REFERENCES accounts(id),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY,
  drawing_code text NOT NULL REFERENCES drawings(code),
  owner_id text NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('granted','withdrawn')),
  granted_at timestamptz NOT NULL,
  ends_at timestamptz,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS ledger_line (
  line_id integer PRIMARY KEY,
  pair_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  account text NOT NULL,
  amount_mm2 bigint NOT NULL,
  stock_code text NOT NULL,
  drawing_code text NOT NULL DEFAULT '',
  actor_email text NOT NULL,
  reason text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ledger_posted_idx ON ledger_line(posted_at DESC, line_id DESC);
CREATE INDEX IF NOT EXISTS ledger_stock_idx ON ledger_line(stock_code, posted_at DESC, line_id DESC);
CREATE INDEX IF NOT EXISTS ledger_account_idx ON ledger_line(account);

CREATE OR REPLACE FUNCTION refuse_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_line is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_no_update ON ledger_line;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_line
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_mutation();

CREATE TABLE IF NOT EXISTS audit_trail (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_email text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  before jsonb,
  after jsonb,
  reason text
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_trail(at DESC);

CREATE OR REPLACE FUNCTION refuse_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit_trail;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_mutation();

CREATE TABLE IF NOT EXISTS account_entries (
  id text PRIMARY KEY,
  drawing_code text NOT NULL REFERENCES drawings(code),
  kind text NOT NULL CHECK (kind IN ('payment','credit_note')),
  amount_pence integer NOT NULL,
  at timestamptz NOT NULL,
  note text,
  reason text,
  recorded_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  scope text NOT NULL,
  status integer NOT NULL,
  body_text text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key, scope)
);

CREATE TABLE IF NOT EXISTS rate_counts (
  account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('submission','sheet_fetch')),
  at timestamptz NOT NULL,
  PRIMARY KEY (account_id, kind, at)
);

CREATE TABLE IF NOT EXISTS sequences (
  name text PRIMARY KEY,
  next_value integer NOT NULL
);

CREATE TABLE IF NOT EXISTS cursors (
  token text PRIMARY KEY,
  filter jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_lock (id integer PRIMARY KEY DEFAULT 1, done boolean NOT NULL);
