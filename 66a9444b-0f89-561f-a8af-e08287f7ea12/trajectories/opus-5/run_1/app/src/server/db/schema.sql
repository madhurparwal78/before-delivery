CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
  id   text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL,
  organisation_id text REFERENCES organisations(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edition (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name       text NOT NULL,
  first_day  date NOT NULL,
  last_day   date NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS disciplines (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS price_policy (
  id                           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_festival_full_cents     int NOT NULL,
  full_festival_reduced_cents  int NOT NULL,
  day_full_cents               int NOT NULL,
  day_reduced_cents            int NOT NULL,
  group_discount_percent       int NOT NULL,
  version                      int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS programme_sessions (
  id                  text PRIMARY KEY,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  discipline          text NOT NULL REFERENCES disciplines(id),
  venue_id            text NOT NULL REFERENCES venues(id),
  admission           text NOT NULL CHECK (admission IN ('pass', 'seat')),
  capacity            int,
  price_full_cents    int,
  price_reduced_cents int,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  status              text NOT NULL,
  publish_at          timestamptz,
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_history (
  id          uuid PRIMARY KEY,
  session_id  text NOT NULL REFERENCES programme_sessions(id),
  from_state  text,
  to_state    text NOT NULL,
  at          timestamptz NOT NULL,
  actor       text NOT NULL,
  note        text
);

CREATE TABLE IF NOT EXISTS entries (
  id         text PRIMARY KEY,
  artist_id  uuid NOT NULL REFERENCES users(id),
  title      text NOT NULL,
  statement  text NOT NULL DEFAULT '',
  discipline text NOT NULL REFERENCES disciplines(id),
  medium     text NOT NULL DEFAULT '',
  year       text NOT NULL DEFAULT '',
  status     text NOT NULL,
  publish_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entry_images (
  id           uuid PRIMARY KEY,
  entry_id     text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  width        int NOT NULL,
  height       int NOT NULL,
  original_key text NOT NULL,
  display_key  text NOT NULL,
  content_type text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entry_history (
  id         uuid PRIMARY KEY,
  entry_id   text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  from_state text,
  to_state   text NOT NULL,
  at         timestamptz NOT NULL,
  actor      text NOT NULL,
  note       text
);

CREATE TABLE IF NOT EXISTS holds (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  session_id text NOT NULL REFERENCES programme_sessions(id),
  quantity   int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status     text NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_session_idx ON holds (session_id, status);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id                uuid PRIMARY KEY,
  seq               bigserial NOT NULL,
  user_id           uuid NOT NULL REFERENCES users(id),
  session_id        text NOT NULL REFERENCES programme_sessions(id),
  status            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  offer_expires_at  timestamptz,
  offered_at        timestamptz
);
CREATE INDEX IF NOT EXISTS waitlist_session_idx ON waitlist_entries (session_id, status, seq);

CREATE TABLE IF NOT EXISTS orders (
  id                   uuid PRIMARY KEY,
  ref                  text NOT NULL UNIQUE,
  user_id              uuid NOT NULL REFERENCES users(id),
  organisation_id      text REFERENCES organisations(id),
  rate                 text NOT NULL CHECK (rate IN ('full', 'reduced')),
  subtotal_cents       int NOT NULL,
  group_discount_cents int NOT NULL,
  voucher_code         text,
  voucher_cents        int NOT NULL,
  total_cents          int NOT NULL,
  proof_deadline       timestamptz,
  killbill_account_id  text,
  killbill_payment_id  text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_lines (
  id                   uuid PRIMARY KEY,
  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position             int NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('seat', 'full_festival', 'day')),
  session_id           text REFERENCES programme_sessions(id),
  festival_day         date,
  title                text NOT NULL,
  holder_name          text NOT NULL,
  state                text NOT NULL,
  list_cents           int NOT NULL,
  group_discount_cents int NOT NULL,
  voucher_cents        int NOT NULL,
  charged_cents        int NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_session_idx ON order_lines (session_id, state);

CREATE TABLE IF NOT EXISTS passes (
  id          uuid PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  line_id     uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  holder_name text NOT NULL,
  status      text NOT NULL,
  object_key  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passes_line_idx ON passes (line_id);

CREATE TABLE IF NOT EXISTS proofs (
  id           uuid PRIMARY KEY,
  order_id     uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  status       text NOT NULL,
  uploaded_at  timestamptz NOT NULL,
  deadline     timestamptz NOT NULL,
  content_type text NOT NULL,
  size_bytes   int NOT NULL,
  object_key   text NOT NULL,
  decided_by   text,
  decided_at   timestamptz,
  reason       text
);

CREATE TABLE IF NOT EXISTS refunds (
  id             uuid PRIMARY KEY,
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_ids       uuid[] NOT NULL,
  card_cents     int NOT NULL,
  voucher_cents  int NOT NULL,
  credit_note_id uuid,
  status         text NOT NULL,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers (
  code       text PRIMARY KEY,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_movements (
  id           uuid PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('issue', 'redeem', 'return')),
  amount_cents int NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  order_ref    text,
  voucher_code text NOT NULL REFERENCES vouchers(code)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id           uuid PRIMARY KEY,
  movement_id  uuid NOT NULL REFERENCES ledger_movements(id),
  account      text NOT NULL,
  side         text NOT NULL CHECK (side IN ('debit', 'credit')),
  amount_cents int NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS invoices (
  id                  uuid PRIMARY KEY,
  number              text NOT NULL UNIQUE,
  organisation_id     text NOT NULL REFERENCES organisations(id),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status              text NOT NULL,
  amount_cents        int NOT NULL,
  issued_at           timestamptz NOT NULL,
  due_at              timestamptz NOT NULL,
  retries_used        int NOT NULL DEFAULT 0,
  next_retry_at       timestamptz,
  retried_at          timestamptz,
  collection_pending  boolean NOT NULL DEFAULT false,
  killbill_invoice_id text
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id                       uuid PRIMARY KEY,
  invoice_id               uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_id                  uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  description              text NOT NULL,
  amount_cents             int NOT NULL,
  killbill_invoice_item_id text
);

CREATE TABLE IF NOT EXISTS invoice_collections (
  id                  uuid PRIMARY KEY,
  invoice_id          uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  attempt             int NOT NULL,
  amount_cents        int NOT NULL,
  killbill_payment_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, attempt)
);

CREATE TABLE IF NOT EXISTS invoice_returns (
  id             uuid PRIMARY KEY,
  invoice_id     uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  collection_id  uuid NOT NULL REFERENCES invoice_collections(id) ON DELETE CASCADE,
  amount_cents   int NOT NULL,
  note           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id         uuid PRIMARY KEY,
  number     text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  refund_id  uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  issued_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_note_lines (
  id             uuid PRIMARY KEY,
  credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  line_id        uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  description    text NOT NULL,
  amount_cents   int NOT NULL,
  killbill_adjustment_id text
);

CREATE TABLE IF NOT EXISTS scans (
  id            uuid PRIMARY KEY,
  pass_code     text NOT NULL,
  session_id    text REFERENCES programme_sessions(id),
  result        text NOT NULL,
  reason        text,
  festival_day  date,
  at            timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_pass_idx ON scans (pass_code, result);

CREATE TABLE IF NOT EXISTS outbox (
  id          bigserial PRIMARY KEY,
  event_key   text NOT NULL UNIQUE,
  message_id  text NOT NULL,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'queued',
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           text NOT NULL,
  endpoint      text NOT NULL,
  body_hash     text NOT NULL,
  state         text NOT NULL,
  status_code   int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, endpoint)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id          uuid PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_target_idx ON audit_entries (target_id, at DESC);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  external_key        text PRIMARY KEY,
  killbill_account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_records (
  id                       uuid PRIMARY KEY,
  order_id                 uuid REFERENCES orders(id) ON DELETE CASCADE,
  invoice_id               uuid REFERENCES invoices(id) ON DELETE CASCADE,
  refund_id                uuid REFERENCES refunds(id) ON DELETE CASCADE,
  killbill_transaction_id  text,
  external_key             text NOT NULL,
  transaction_type         text NOT NULL,
  amount_cents             int NOT NULL,
  status                   text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_records_tx_idx ON payment_records (killbill_transaction_id);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                   uuid PRIMARY KEY,
  started_at           timestamptz NOT NULL,
  finished_at          timestamptz NOT NULL,
  checked_transactions int NOT NULL
);

CREATE TABLE IF NOT EXISTS mismatches (
  id                      uuid PRIMARY KEY,
  run_id                  uuid NOT NULL REFERENCES reconciliation_runs(id),
  dedupe_key              text NOT NULL UNIQUE,
  type                    text NOT NULL,
  order_ref               text,
  killbill_transaction_id text,
  transaction_type        text NOT NULL,
  app_amount_cents        int,
  killbill_amount_cents   int,
  status                  text NOT NULL,
  note                    text,
  resolved_by             text,
  resolved_at             timestamptz
);

CREATE TABLE IF NOT EXISTS sequences (
  name  text PRIMARY KEY,
  value int NOT NULL
);
