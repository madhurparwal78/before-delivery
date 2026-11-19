/** The whole schema, applied idempotently under the database-wide lock. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS code_seq (name text PRIMARY KEY, next bigint NOT NULL);
CREATE SEQUENCE IF NOT EXISTS opaque_seq;
CREATE SEQUENCE IF NOT EXISTS ledger_line_seq START 1201;

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  num int NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('sailmaker', 'loft-hand', 'yacht-owner')),
  keycloak_id text UNIQUE,
  seeded boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS cloth (
  code text PRIMARY KEY,
  name text NOT NULL,
  weight text NOT NULL,
  width_mm int NOT NULL,
  usable_width_mm int NOT NULL,
  rate_pence_per_m2 int NOT NULL
);

CREATE TABLE IF NOT EXISTS closure (day date PRIMARY KEY);

CREATE TABLE IF NOT EXISTS ruleset (
  version int PRIMARY KEY,
  effective_at timestamptz NOT NULL,
  seam_overlap_mm int NOT NULL,
  roach_permille int NOT NULL,
  tolerance_mm int NOT NULL,
  min_offcut_width_mm int NOT NULL,
  min_offcut_length_mm int NOT NULL,
  revision int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS boat (
  code text PRIMARY KEY,
  num int NOT NULL UNIQUE,
  name text NOT NULL,
  class_name text NOT NULL,
  owner_id text NOT NULL REFERENCES account(id),
  notes text NOT NULL DEFAULT '',
  revision int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS measurement (
  id text PRIMARY KEY,
  seq bigserial NOT NULL,
  boat_code text NOT NULL REFERENCES boat(code),
  dimension text NOT NULL,
  value_mm int NOT NULL,
  measured_on date NOT NULL,
  source text NOT NULL,
  submission_id text,
  tolerance_mm int NOT NULL,
  photo_key text,
  photo_size int,
  photo_sha256 text,
  photo_type text
);
CREATE INDEX IF NOT EXISTS measurement_boat ON measurement (boat_code, dimension, measured_on, seq);

CREATE TABLE IF NOT EXISTS submission (
  id text PRIMARY KEY,
  num int NOT NULL UNIQUE,
  boat_code text NOT NULL REFERENCES boat(code),
  dimension text NOT NULL,
  value_mm int NOT NULL,
  as_submitted text NOT NULL,
  measured_on date NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL,
  submitted_by text NOT NULL REFERENCES account(id),
  submitted_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  reason text,
  measurement_id text
);
CREATE INDEX IF NOT EXISTS submission_status ON submission (status, submitted_at);
CREATE INDEX IF NOT EXISTS submission_owner ON submission (submitted_by);

CREATE TABLE IF NOT EXISTS drawing (
  code text PRIMARY KEY,
  num int NOT NULL UNIQUE,
  boat_code text NOT NULL REFERENCES boat(code),
  sail text NOT NULL,
  cloth_code text NOT NULL REFERENCES cloth(code),
  phase text NOT NULL,
  ruleset_version int,
  assigned_to text REFERENCES account(id),
  luff_mm int,
  foot_mm int,
  area_mm2 bigint,
  area_basis text,
  recorded_boat_name text,
  recorded_owner_name text,
  recorded_dims jsonb,
  predecessor text,
  cut_sheet_sha text,
  cut_sheet_size int,
  cut_sheet_key text
);
CREATE INDEX IF NOT EXISTS drawing_boat ON drawing (boat_code);
CREATE INDEX IF NOT EXISTS drawing_phase ON drawing (phase);
CREATE INDEX IF NOT EXISTS drawing_sha ON drawing (cut_sheet_sha);

CREATE TABLE IF NOT EXISTS panel (
  drawing_code text NOT NULL REFERENCES drawing(code),
  number int NOT NULL,
  outline jsonb NOT NULL,
  length_mm int NOT NULL,
  width_mm int NOT NULL,
  area_mm2 bigint NOT NULL,
  cut boolean NOT NULL DEFAULT false,
  PRIMARY KEY (drawing_code, number)
);

CREATE TABLE IF NOT EXISTS stock (
  code text PRIMARY KEY,
  num int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('roll', 'offcut')),
  cloth_code text NOT NULL REFERENCES cloth(code),
  lot text NOT NULL,
  width_mm int NOT NULL,
  usable_width_mm int NOT NULL,
  remaining_mm int NOT NULL CHECK (remaining_mm >= 0),
  on_hand_mm2 bigint NOT NULL,
  shelf_location text NOT NULL,
  note text NOT NULL DEFAULT '',
  last_count_mm int,
  last_count_at timestamptz,
  revision int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS claim (
  id text PRIMARY KEY,
  stock_code text NOT NULL REFERENCES stock(code),
  drawing_code text NOT NULL REFERENCES drawing(code),
  holder_id text NOT NULL REFERENCES account(id),
  length_mm int NOT NULL,
  status text NOT NULL CHECK (status IN ('held', 'cut', 'released')),
  taken_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_mm int
);
CREATE INDEX IF NOT EXISTS claim_stock ON claim (stock_code);
CREATE INDEX IF NOT EXISTS claim_drawing ON claim (drawing_code);

CREATE TABLE IF NOT EXISTS lay (
  seq bigserial NOT NULL,
  claim_id text NOT NULL REFERENCES claim(id),
  panel_number int NOT NULL,
  drawing_code text NOT NULL,
  x_mm int NOT NULL,
  y_mm int NOT NULL,
  rotation int NOT NULL,
  outline jsonb NOT NULL,
  max_x int NOT NULL,
  PRIMARY KEY (claim_id, panel_number)
);
CREATE INDEX IF NOT EXISTS lay_drawing ON lay (drawing_code, panel_number);

CREATE TABLE IF NOT EXISTS cut_key (
  key text PRIMARY KEY,
  claim_id text NOT NULL,
  status int NOT NULL,
  body text NOT NULL
);

CREATE TABLE IF NOT EXISTS authority (
  id text PRIMARY KEY,
  loft_hand_id text NOT NULL REFERENCES account(id),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS sight_grant (
  id text PRIMARY KEY,
  num int NOT NULL UNIQUE,
  drawing_code text NOT NULL REFERENCES drawing(code),
  owner_id text NOT NULL REFERENCES account(id),
  granted_at timestamptz NOT NULL,
  ends_at timestamptz,
  withdrawn_at timestamptz
);
CREATE INDEX IF NOT EXISTS grant_owner ON sight_grant (owner_id);
CREATE INDEX IF NOT EXISTS grant_drawing ON sight_grant (drawing_code);

CREATE TABLE IF NOT EXISTS sail_entry (
  id text PRIMARY KEY,
  drawing_code text NOT NULL REFERENCES drawing(code),
  kind text NOT NULL,
  amount_pence int NOT NULL,
  at timestamptz NOT NULL,
  note text,
  reason text,
  recorded_by text NOT NULL
);
CREATE INDEX IF NOT EXISTS sail_entry_drawing ON sail_entry (drawing_code);

CREATE TABLE IF NOT EXISTS payment_key (
  key text PRIMARY KEY,
  drawing_code text NOT NULL,
  amount_pence int NOT NULL,
  note text NOT NULL,
  status int NOT NULL,
  body text NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_line (
  line_id bigint PRIMARY KEY,
  pair_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  account text NOT NULL,
  amount_mm2 bigint NOT NULL,
  stock_code text NOT NULL,
  drawing_code text NOT NULL DEFAULT '',
  actor_email text NOT NULL,
  reason text NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_order ON ledger_line (posted_at DESC, line_id DESC);
CREATE INDEX IF NOT EXISTS ledger_stock ON ledger_line (stock_code, posted_at DESC, line_id DESC);

CREATE TABLE IF NOT EXISTS audit_trail (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  at timestamptz NOT NULL,
  actor_email text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  before text,
  after text,
  reason text
);
CREATE INDEX IF NOT EXISTS audit_order ON audit_trail (at DESC, seq DESC);

CREATE TABLE IF NOT EXISTS rate_event (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL,
  kind text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_event_account ON rate_event (account_id, kind, at);

CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed or removed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_line_immutable') THEN
    CREATE TRIGGER ledger_line_immutable BEFORE UPDATE OR DELETE ON ledger_line FOR EACH ROW EXECUTE FUNCTION refuse_change();
    CREATE TRIGGER ledger_line_no_truncate BEFORE TRUNCATE ON ledger_line FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_trail_immutable') THEN
    CREATE TRIGGER audit_trail_immutable BEFORE UPDATE OR DELETE ON audit_trail FOR EACH ROW EXECUTE FUNCTION refuse_change();
    CREATE TRIGGER audit_trail_no_truncate BEFORE TRUNCATE ON audit_trail FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
  END IF;
END
$$;
`;
