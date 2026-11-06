// The schema, applied idempotently at every start. Three rules live here as SQL functions so every query
// shares them: when a time-limited item is live, a programme item's effective status, and seats remaining.
export const SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value integer NOT NULL);

CREATE TABLE IF NOT EXISTS organisations (id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
  role text NOT NULL, organisation_id text REFERENCES organisations(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS edition (id integer PRIMARY KEY CHECK (id = 1), name text NOT NULL, first_day date NOT NULL, last_day date NOT NULL);
CREATE TABLE IF NOT EXISTS venues (id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS disciplines (id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS price_policy (
  id integer PRIMARY KEY CHECK (id = 1), full_festival_full_cents integer NOT NULL, full_festival_reduced_cents integer NOT NULL,
  day_full_cents integer NOT NULL, day_reduced_cents integer NOT NULL, group_discount_percent integer NOT NULL, version integer NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, title text NOT NULL, description text NOT NULL, discipline text NOT NULL REFERENCES disciplines(id),
  venue_id text NOT NULL REFERENCES venues(id), admission text NOT NULL, capacity integer, price_full_cents integer,
  price_reduced_cents integer, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL,
  publish_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS entries (
  id text PRIMARY KEY, artist_id text NOT NULL REFERENCES users(id), title text NOT NULL, statement text NOT NULL,
  discipline text NOT NULL REFERENCES disciplines(id), medium text NOT NULL, year integer NOT NULL, status text NOT NULL,
  publish_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS state_history (
  seq bigserial PRIMARY KEY, item_kind text NOT NULL, item_id text NOT NULL, from_state text NOT NULL, to_state text NOT NULL,
  at timestamptz NOT NULL, by text NOT NULL, note text);
CREATE INDEX IF NOT EXISTS state_history_item ON state_history (item_kind, item_id, seq);
CREATE TABLE IF NOT EXISTS entry_images (
  id text PRIMARY KEY, entry_id text NOT NULL REFERENCES entries(id), width integer NOT NULL, height integer NOT NULL,
  content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), session_id text NOT NULL REFERENCES sessions(id),
  quantity integer NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS holds_session ON holds (session_id, status);
CREATE INDEX IF NOT EXISTS holds_user ON holds (user_id, status);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY, seq bigserial, user_id text NOT NULL REFERENCES users(id), session_id text NOT NULL REFERENCES sessions(id),
  status text NOT NULL, joined_at timestamptz NOT NULL, offer_expires_at timestamptz);
CREATE INDEX IF NOT EXISTS waitlist_session ON waitlist_entries (session_id, status, seq);

CREATE TABLE IF NOT EXISTS vouchers (code text PRIMARY KEY, note text, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS voucher_movements (
  id text PRIMARY KEY, seq bigserial, voucher_code text NOT NULL REFERENCES vouchers(code), kind text NOT NULL,
  amount_cents integer NOT NULL, created_at timestamptz NOT NULL, actor text NOT NULL, order_ref text);
CREATE TABLE IF NOT EXISTS ledger_entries (
  seq bigserial PRIMARY KEY, movement_id text NOT NULL REFERENCES voucher_movements(id), account text NOT NULL,
  side text NOT NULL, amount_cents integer NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, ref text NOT NULL UNIQUE, buyer_id text NOT NULL REFERENCES users(id), organisation_id text REFERENCES organisations(id),
  rate text NOT NULL, voucher_code text, proof_deadline timestamptz, kb_payment_id text, confirmation_outbox_id bigint,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS orders_buyer ON orders (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS orders_org ON orders (organisation_id);
CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), position integer NOT NULL, kind text NOT NULL,
  session_id text REFERENCES sessions(id), festival_day date, title text NOT NULL, holder_name text NOT NULL, state text NOT NULL,
  list_cents integer NOT NULL, group_discount_cents integer NOT NULL, voucher_cents integer NOT NULL, charged_cents integer NOT NULL);
CREATE INDEX IF NOT EXISTS lines_order ON lines (order_id, position);
CREATE INDEX IF NOT EXISTS lines_session ON lines (session_id, state);
CREATE TABLE IF NOT EXISTS passes (
  code text PRIMARY KEY, line_id text NOT NULL REFERENCES lines(id), status text NOT NULL, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS passes_line ON passes (line_id, created_at);

CREATE TABLE IF NOT EXISTS proofs (
  id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id), kind text NOT NULL, status text NOT NULL,
  uploaded_at timestamptz NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, decided_at timestamptz,
  decided_by text, reason text);

CREATE TABLE IF NOT EXISTS scans (
  seq bigserial PRIMARY KEY, pass_code text NOT NULL, session_id text NOT NULL, festival_day date NOT NULL, venue_id text NOT NULL,
  result text NOT NULL, reason text, scanned_at timestamptz NOT NULL, staff_id text NOT NULL);
CREATE INDEX IF NOT EXISTS scans_pass ON scans (pass_code, result);
CREATE INDEX IF NOT EXISTS scans_day ON scans (festival_day, result);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY, number text NOT NULL UNIQUE, organisation_id text NOT NULL REFERENCES organisations(id),
  order_id text NOT NULL REFERENCES orders(id), booker_id text NOT NULL REFERENCES users(id), status text NOT NULL,
  amount_cents integer NOT NULL, issued_at timestamptz NOT NULL, due_at timestamptz NOT NULL, retries_used integer NOT NULL DEFAULT 0,
  first_return_at timestamptz, next_retry_at timestamptz, retried_at timestamptz, kb_invoice_id text NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id text NOT NULL REFERENCES invoices(id), line_id text NOT NULL REFERENCES lines(id), description text NOT NULL,
  amount_cents integer NOT NULL, kb_item_id text NOT NULL, PRIMARY KEY (invoice_id, line_id));
CREATE TABLE IF NOT EXISTS collections (
  invoice_id text NOT NULL REFERENCES invoices(id), attempt integer NOT NULL, kb_payment_id text NOT NULL,
  amount_cents integer NOT NULL, collected_at timestamptz NOT NULL, returned_at timestamptz, PRIMARY KEY (invoice_id, attempt));
CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), line_ids text[] NOT NULL, card_cents integer NOT NULL,
  voucher_cents integer NOT NULL, credit_note_id text, status text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL,
  completed_at timestamptz);
CREATE TABLE IF NOT EXISTS credit_notes (
  id text PRIMARY KEY, number text NOT NULL UNIQUE, invoice_id text NOT NULL REFERENCES invoices(id),
  amount_cents integer NOT NULL, issued_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS credit_note_lines (
  credit_note_id text NOT NULL REFERENCES credit_notes(id), line_id text NOT NULL REFERENCES lines(id), description text NOT NULL,
  amount_cents integer NOT NULL, adjusted boolean NOT NULL DEFAULT false, PRIMARY KEY (credit_note_id, line_id));

CREATE TABLE IF NOT EXISTS killbill_accounts (external_key text PRIMARY KEY, account_id text NOT NULL);
CREATE TABLE IF NOT EXISTS payment_records (
  kb_transaction_id text PRIMARY KEY, kb_payment_id text NOT NULL, transaction_type text NOT NULL, amount_cents integer NOT NULL,
  status text NOT NULL, order_ref text, invoice_number text, recorded_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS payment_tasks (
  id bigserial PRIMARY KEY, kind text NOT NULL, subject_id text NOT NULL, created_at timestamptz NOT NULL, done_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, UNIQUE (kind, subject_id));

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id text PRIMARY KEY, started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL, checked_transactions integer NOT NULL, actor text NOT NULL);
CREATE TABLE IF NOT EXISTS mismatches (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES reconciliation_runs(id), type text NOT NULL, identity text NOT NULL UNIQUE,
  order_ref text, killbill_transaction_id text, transaction_type text NOT NULL, app_amount_cents integer, killbill_amount_cents integer,
  status text NOT NULL, note text, resolved_by text, resolved_at timestamptz, found_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS run_mismatches (
  run_id text NOT NULL REFERENCES reconciliation_runs(id), mismatch_id text NOT NULL REFERENCES mismatches(id), PRIMARY KEY (run_id, mismatch_id));

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL,
  sent_at timestamptz, attempts integer NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS outbox_attachments (
  outbox_id bigint NOT NULL REFERENCES outbox(id), position integer NOT NULL, filename text NOT NULL, content bytea NOT NULL,
  PRIMARY KEY (outbox_id, position));

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer NOT NULL, body jsonb NOT NULL,
  created_at timestamptz NOT NULL, PRIMARY KEY (scope, key));

CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor text NOT NULL, actor_role text NOT NULL, action text NOT NULL,
  target_type text NOT NULL, target_id text NOT NULL, detail jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS audit_target ON audit (target_id, at);

-- A time-limited item is live while server time is strictly before its expiry instant.
CREATE OR REPLACE FUNCTION is_live(expires_at timestamptz, at timestamptz) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT at < expires_at $$;

-- A scheduled item counts as published from its publishing instant on.
CREATE OR REPLACE FUNCTION effective_status(status text, publish_at timestamptz, at timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN status = 'scheduled' AND publish_at <= at THEN 'published' ELSE status END $$;

-- Capacity minus active holds, open waitlist offers and seats on pending, sold or transferred lines.
CREATE OR REPLACE FUNCTION seats_remaining(sid text, at timestamptz) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN s.capacity IS NULL THEN NULL ELSE GREATEST(0, s.capacity
    - COALESCE((SELECT sum(h.quantity) FROM holds h WHERE h.session_id = sid AND h.status = 'active' AND is_live(h.expires_at, at)), 0)
    - (SELECT count(*) FROM waitlist_entries w WHERE w.session_id = sid AND w.status = 'offered' AND is_live(w.offer_expires_at, at))
    - (SELECT count(*) FROM lines l WHERE l.session_id = sid AND l.state IN ('proof_pending', 'captured', 'transferred')))::integer END
  FROM sessions s WHERE s.id = sid
$$;
`;
