/** Applied idempotently on every start, under the migrate lock. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS desks (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS desks_email ON desks (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks,
  name text NOT NULL,
  town text NOT NULL,
  language text NOT NULL,
  email text,
  state text NOT NULL DEFAULT 'active',
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_desk ON clients (desk_id);

CREATE TABLE IF NOT EXISTS pieces (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks,
  client_id text NOT NULL REFERENCES clients,
  title text NOT NULL,
  maker text,
  year text,
  stamp_number text,
  width_cm text,
  depth_cm text,
  height_cm text,
  weight_kg text,
  due_date date,
  notes text,
  state text NOT NULL DEFAULT 'received',
  last_pin_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pieces_desk ON pieces (desk_id, title, id);
CREATE UNIQUE INDEX IF NOT EXISTS pieces_stamp ON pieces (desk_id, stamp_number) WHERE stamp_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS pins (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  number integer NOT NULL,
  x_tenths integer NOT NULL,
  y_tenths integer NOT NULL,
  kind text NOT NULL,
  note text NOT NULL DEFAULT '',
  signed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS pins_piece ON pins (piece_id);

CREATE TABLE IF NOT EXISTS photographs (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  number integer NOT NULL,
  side text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (piece_id, sha256),
  UNIQUE (piece_id, number)
);

CREATE TABLE IF NOT EXISTS layouts (
  piece_id text PRIMARY KEY REFERENCES pieces ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  placements jsonb NOT NULL DEFAULT '[]',
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  desk_id text NOT NULL REFERENCES desks,
  code text NOT NULL,
  name text NOT NULL,
  family text NOT NULL,
  unit text NOT NULL,
  prices jsonb NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (desk_id, code)
);

CREATE TABLE IF NOT EXISTS stock_reads (
  code text PRIMARY KEY,
  lots jsonb NOT NULL,
  read_at timestamptz NOT NULL
);

/* Retry-After instants of the two providers: no call to that provider before the instant. */
CREATE TABLE IF NOT EXISTS provider_waits (
  provider text PRIMARY KEY,
  until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  code text NOT NULL,
  lot text NOT NULL,
  quantity text NOT NULL,
  hold_id text NOT NULL,
  ends_on date NOT NULL,
  UNIQUE (piece_id, code, lot)
);

CREATE TABLE IF NOT EXISTS rates (
  desk_id text NOT NULL REFERENCES desks,
  takes_effect_on date NOT NULL,
  eur text NOT NULL,
  gbp text NOT NULL,
  usd text NOT NULL,
  jpy text NOT NULL,
  aed text NOT NULL,
  PRIMARY KEY (desk_id, takes_effect_on)
);

CREATE TABLE IF NOT EXISTS estimates (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  version integer NOT NULL,
  state text NOT NULL,
  currency text NOT NULL,
  material_code text,
  material_name text,
  lot text,
  pattern_area_sq_ft text,
  hides integer,
  metres text,
  labour_hours text NOT NULL,
  labour_rate_minor bigint NOT NULL,
  material_minor bigint NOT NULL,
  labour_minor bigint NOT NULL,
  subtotal_minor bigint NOT NULL,
  tax_percent integer NOT NULL,
  tax_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (piece_id, version)
);

CREATE TABLE IF NOT EXISTS client_pages (
  token text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  address text,
  language text NOT NULL,
  sent_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  reminder_at timestamptz,
  reminded_at timestamptz,
  seat_height_cm text,
  seat_height_typed text,
  answered_at timestamptz,
  signed_name text,
  signed_at timestamptz,
  signed_estimate_id text
);
CREATE INDEX IF NOT EXISTS client_pages_piece ON client_pages (piece_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS bench_jobs (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  bench text NOT NULL,
  day date NOT NULL,
  glue_laid_at timestamptz,
  UNIQUE (desk_id, bench, day)
);

CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  quote_id text NOT NULL,
  repeat_key text NOT NULL,
  courier_id text,
  state text NOT NULL,
  collect_at timestamptz NOT NULL,
  local_date date NOT NULL,
  local_time text NOT NULL,
  town text NOT NULL,
  label_sha256 text,
  state_read_at timestamptz,
  UNIQUE (piece_id, repeat_key)
);

CREATE TABLE IF NOT EXISTS dossiers (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  estimate_id text NOT NULL,
  state text NOT NULL,
  message text,
  signed_by text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dossiers_piece ON dossiers (piece_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dossier_history (
  id bigserial PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  who text NOT NULL,
  what text NOT NULL
);

/* One row per scope, counting its requests in the window: enquiries per address, downloads per desk. */
CREATE TABLE IF NOT EXISTS rate_windows (
  scope text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  count integer NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  client_id text,
  to_address text NOT NULL,
  reply_to text,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz
);

/* Seed files waiting for their provider: photographs, labels and the signed dossier. */
CREATE TABLE IF NOT EXISTS seed_files (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  ref text NOT NULL,
  done_at timestamptz,
  UNIQUE (kind, ref)
);
`;
