// Idempotent schema, applied at start (DP-53).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_live ON members (email) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_member ON sessions (member_id);

CREATE TABLE IF NOT EXISTS ladders (
  id uuid PRIMARY KEY,
  effective_on date NOT NULL UNIQUE,
  first_markdown_percent int NOT NULL,
  first_markdown_day int NOT NULL,
  second_markdown_percent int NOT NULL,
  second_markdown_day int NOT NULL,
  period_end_day int NOT NULL
);

CREATE TABLE IF NOT EXISTS consignors (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text,
  phone text,
  iban text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS consignors_email_live ON consignors (lower(email)) WHERE status <> 'erased' AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS pieces (
  id uuid PRIMARY KEY,
  tag_digits text NOT NULL UNIQUE,
  consignor_id uuid NOT NULL REFERENCES consignors(id),
  category text NOT NULL,
  brand text NOT NULL,
  description text NOT NULL,
  size text NOT NULL,
  condition text NOT NULL,
  asking_price_cents int NOT NULL,
  intake_date date NOT NULL,
  ladder_id uuid NOT NULL REFERENCES ladders(id),
  version int NOT NULL DEFAULT 0,
  status text NOT NULL,
  choice text,
  archived_at timestamptz,
  collected_at timestamptz,
  import_item_no text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pieces_consignor ON pieces (consignor_id);
CREATE INDEX IF NOT EXISTS pieces_status ON pieces (status);

CREATE TABLE IF NOT EXISTS price_history (
  id bigserial PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  asking_price_cents int NOT NULL,
  effective_from timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_piece ON price_history (piece_id, effective_from);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  content_type text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  position int NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_piece ON photos (piece_id);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  shopper_name text NOT NULL,
  shopper_email text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_token ON holds (token);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_hold_per_piece ON holds (piece_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS holds_piece ON holds (piece_id);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  sold_at timestamptz NOT NULL,
  price_cents int NOT NULL,
  consignor_share_cents int NOT NULL,
  commission_cents int NOT NULL,
  vat_cents int NOT NULL,
  payment text NOT NULL,
  sold_by uuid NOT NULL REFERENCES members(id),
  refunded_at timestamptz,
  refundable_until timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_piece_live ON sales (piece_id) WHERE refunded_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_month ON sales (sold_at);

CREATE TABLE IF NOT EXISTS request_keys (
  key text NOT NULL,
  member_id uuid NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key, member_id)
);

CREATE TABLE IF NOT EXISTS payout_runs (
  month text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  started_by uuid NOT NULL REFERENCES members(id),
  ready_at timestamptz,
  status text NOT NULL,
  control_sum_cents int NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_run_per_month ON payout_runs (month);

CREATE TABLE IF NOT EXISTS payouts (
  id text PRIMARY KEY,
  month text NOT NULL REFERENCES payout_runs(month),
  consignor_id uuid NOT NULL REFERENCES consignors(id),
  consignor_name text NOT NULL,
  iban text,
  amount_cents int NOT NULL,
  status text NOT NULL,
  reason text
);
CREATE INDEX IF NOT EXISTS payouts_month ON payouts (month);

CREATE TABLE IF NOT EXISTS payout_sales (
  payout_id text NOT NULL REFERENCES payouts(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  PRIMARY KEY (payout_id, sale_id)
);

CREATE TABLE IF NOT EXISTS portal_links (
  consignor_id uuid PRIMARY KEY REFERENCES consignors(id),
  token text NOT NULL UNIQUE,
  ends_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY,
  starts_at timestamptz NOT NULL UNIQUE,
  ends_at timestamptz NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  cancel_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_appointment_per_slot ON appointments (starts_at) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS booking_log (
  email_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_log_email ON booking_log (email_key, created_at);

CREATE TABLE IF NOT EXISTS book_downloads (
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS book_downloads_member ON book_downloads (member_id, created_at);

CREATE TABLE IF NOT EXISTS erasure_deletions (
  consignor_id uuid PRIMARY KEY REFERENCES consignors(id),
  photo_count int NOT NULL,
  deleted_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shop_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);
`;
