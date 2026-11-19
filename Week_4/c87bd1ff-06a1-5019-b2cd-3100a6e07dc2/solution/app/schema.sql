CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, n bigint NOT NULL);
INSERT INTO counters (name, n) VALUES ('event', 0), ('invoice', 0), ('statement', 0), ('paddle', 100)
  ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  sub text UNIQUE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS registrations (
  id text PRIMARY KEY,
  person_id text NOT NULL UNIQUE REFERENCES people (id),
  role text NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  status text NOT NULL,
  paddle int UNIQUE,
  spending_limit int,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  state text PRIMARY KEY,
  id text NOT NULL,
  bind text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  next_path text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sales (
  id text PRIMARY KEY,
  title text NOT NULL,
  ends_at timestamptz NOT NULL,
  first_lot_number int NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS lots (
  id text PRIMARY KEY,
  consignor_id text NOT NULL REFERENCES people (id),
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  estimate_low int,
  estimate_high int,
  opening_bid int,
  reserve int,
  condition text NOT NULL DEFAULT '',
  portrait text,
  sale_id text REFERENCES sales (id),
  position int,
  lot_number int,
  closes_at timestamptz,
  price int,
  leader_id text REFERENCES people (id),
  leader_max int,
  bid_count int NOT NULL DEFAULT 0,
  result text,
  hammer int,
  winner_id text REFERENCES people (id),
  decided boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS lots_sale ON lots (sale_id);
CREATE INDEX IF NOT EXISTS lots_due ON lots (closes_at) WHERE state IN ('open', 'extended');
CREATE INDEX IF NOT EXISTS lots_consignor ON lots (consignor_id);

CREATE TABLE IF NOT EXISTS bids (
  n bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  lot_id text NOT NULL REFERENCES lots (id),
  person_id text NOT NULL REFERENCES people (id),
  max_amount int NOT NULL,
  accepted_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_reason text
);
CREATE INDEX IF NOT EXISTS bids_lot ON bids (lot_id, n);
CREATE INDEX IF NOT EXISTS bids_person ON bids (person_id);

CREATE TABLE IF NOT EXISTS watches (
  person_id text NOT NULL REFERENCES people (id),
  lot_id text NOT NULL REFERENCES lots (id),
  notified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (person_id, lot_id)
);

CREATE TABLE IF NOT EXISTS idempotency (
  person_id text NOT NULL REFERENCES people (id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS offers (
  id text PRIMARY KEY,
  lot_id text NOT NULL REFERENCES lots (id),
  person_id text NOT NULL REFERENCES people (id),
  kind text NOT NULL,
  amount int NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_person ON offers (person_id);
CREATE INDEX IF NOT EXISTS offers_due ON offers (expires_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  sale_id text NOT NULL REFERENCES sales (id),
  person_id text NOT NULL REFERENCES people (id),
  status text NOT NULL,
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  defaulted_at timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_person ON invoices (person_id);
CREATE INDEX IF NOT EXISTS invoices_due ON invoices (due_at) WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id text NOT NULL REFERENCES invoices (id),
  lot_id text NOT NULL REFERENCES lots (id),
  source text NOT NULL,
  hammer_cents bigint NOT NULL,
  premium_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  PRIMARY KEY (invoice_id, lot_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices (id),
  amount_cents bigint NOT NULL,
  method text NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS statements (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  sale_id text NOT NULL REFERENCES sales (id),
  consignor_id text NOT NULL REFERENCES people (id),
  version int NOT NULL,
  status text NOT NULL,
  issued_at timestamptz,
  supersedes text,
  superseded_by text,
  note text,
  frozen text
);

CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  person_id text NOT NULL REFERENCES people (id),
  kind text NOT NULL,
  text text NOT NULL,
  lot_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS notices_person ON notices (person_id, id DESC);

CREATE TABLE IF NOT EXISTS events (
  seq bigint PRIMARY KEY,
  kind text NOT NULL,
  lot_id text,
  cause text,
  notice_id bigint,
  person_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
