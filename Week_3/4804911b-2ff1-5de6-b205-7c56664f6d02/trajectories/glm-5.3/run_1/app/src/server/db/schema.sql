-- Schema applied safely on every serve; repeating it changes nothing.

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('editor','stockist')),
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS drinks (
  id text PRIMARY KEY,
  name text NOT NULL,
  carbonated boolean NOT NULL,
  lineup_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS skus (
  code text PRIMARY KEY,
  drink_id text NOT NULL REFERENCES drinks(id),
  variant text NOT NULL,
  format text NOT NULL CHECK (format IN ('carton','pet','glass','can')),
  size_ml int NOT NULL,
  shelf_days int NOT NULL,
  sugar_mg_per_100ml int NOT NULL,
  launch_mrp_paise int NOT NULL,
  catalogue_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
  id serial PRIMARY KEY,
  sku_code text NOT NULL REFERENCES skus(code),
  alias text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS notices (
  number text PRIMARY KEY,
  publish_year int NOT NULL,
  sequence_in_year int NOT NULL
);

CREATE TABLE IF NOT EXISTS notice_versions (
  number text NOT NULL REFERENCES notices(number),
  version int NOT NULL,
  title text NOT NULL,
  effective_date date NOT NULL,
  run_out_until date,
  published_at timestamptz NOT NULL,
  reason text,
  print_state text NOT NULL CHECK (print_state IN ('pending','printable','failed')),
  pdf_sha256 text,
  sheet_id text,
  superseded_by int,
  PRIMARY KEY (number, version)
);

CREATE TABLE IF NOT EXISTS notice_rows (
  number text NOT NULL REFERENCES notices(number),
  version int NOT NULL,
  row_index int NOT NULL,
  sku_code text NOT NULL REFERENCES skus(code),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sticker','new_print')),
  old_mrp_paise int NOT NULL,
  revised_mrp_paise int NOT NULL,
  old_rate int,
  new_rate int,
  PRIMARY KEY (number, version, row_index)
);

CREATE TABLE IF NOT EXISTS batches (
  code text PRIMARY KEY,
  sku_code text NOT NULL REFERENCES skus(code),
  packed_date date NOT NULL,
  old_wrapper boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sku_history (
  id serial PRIMARY KEY,
  sku_code text NOT NULL REFERENCES skus(code),
  at timestamptz NOT NULL,
  field text NOT NULL CHECK (field IN ('drink_name','variant')),
  from_value text NOT NULL,
  to_value text NOT NULL
);

CREATE TABLE IF NOT EXISTS sheets (
  id text PRIMARY KEY,
  filename text NOT NULL,
  sha256 text NOT NULL UNIQUE,
  size_bytes int NOT NULL,
  imported_at timestamptz NOT NULL,
  row_count int NOT NULL,
  object_confirmed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sheet_rows (
  sheet_id text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  code text,
  description text NOT NULL,
  new_mrp text,
  old_gst text,
  new_gst text,
  status text NOT NULL CHECK (status IN ('matched','ambiguous','unmatched','settled')),
  matched_by text CHECK (matched_by IN ('sku_code','alias','name_size')),
  sku_code text,
  candidates text,
  reason text,
  new_mrp_paise int,
  old_rate int,
  new_rate int,
  merged_into_row int,
  ignored boolean NOT NULL DEFAULT false,
  final_settled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sheet_id, row_number)
);

CREATE TABLE IF NOT EXISTS drafts (
  id text PRIMARY KEY,
  revision int NOT NULL,
  title text NOT NULL,
  effective_date date NOT NULL,
  run_out_until date,
  sheet_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_rows (
  draft_id text NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  row_index int NOT NULL,
  sku_code text NOT NULL REFERENCES skus(code),
  kind text NOT NULL CHECK (kind IN ('sticker','new_print')),
  revised_mrp_paise int NOT NULL,
  old_rate int,
  new_rate int,
  PRIMARY KEY (draft_id, row_index)
);

CREATE TABLE IF NOT EXISTS endpoints (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  url text NOT NULL,
  normalised_url text NOT NULL,
  signing_secret text NOT NULL,
  svix_endpoint_id text,
  registered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  removed boolean NOT NULL DEFAULT false,
  rotating boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS deliveries (
  event_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  endpoint_id text NOT NULL,
  notice_number text,
  notice_version int,
  event_type text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','delivered','failed','redelivered','cancelled')),
  redelivery_requested boolean NOT NULL DEFAULT false,
  redelivery_outstanding boolean NOT NULL DEFAULT false,
  handed_over boolean NOT NULL DEFAULT false,
  cancelled boolean NOT NULL DEFAULT false,
  known_attempt_count int NOT NULL DEFAULT 0,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id serial PRIMARY KEY,
  event_id text NOT NULL REFERENCES deliveries(event_id),
  response_status int,
  outcome text NOT NULL CHECK (outcome IN ('success','pending','failed')),
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('render','index','send','send_test','remove_endpoint','register_endpoint','rotate_secret','redeliver','recover','defer_send','pending_secret')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS held_work (
  id serial PRIMARY KEY,
  job_body text NOT NULL,
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skus_drink ON skus(drink_id);
CREATE INDEX IF NOT EXISTS idx_batches_sku ON batches(sku_code);
CREATE INDEX IF NOT EXISTS idx_notice_rows_sku ON notice_rows(sku_code);
CREATE INDEX IF NOT EXISTS idx_notice_versions_number ON notice_versions(number);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet ON sheet_rows(sheet_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_account ON endpoints(account_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_account ON deliveries(account_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON deliveries(endpoint_id);
