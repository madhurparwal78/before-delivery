export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS archive_chapters (
     number integer PRIMARY KEY,
     numeral text NOT NULL,
     title text NOT NULL,
     era text NOT NULL,
     body text NOT NULL,
     sightline_deg integer NOT NULL,
     exhibit text,
     status text NOT NULL,
     publish_at timestamptz,
     owner_email text NOT NULL,
     withdraw_reason text
   )`,
  `CREATE TABLE IF NOT EXISTS timeline_events (
     id text PRIMARY KEY,
     chapter integer NOT NULL,
     year integer NOT NULL,
     title text NOT NULL,
     summary text NOT NULL,
     source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
     status text NOT NULL,
     publish_at timestamptz,
     owner_email text NOT NULL,
     withdraw_reason text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sources (
     id text PRIMARY KEY,
     ordinal integer NOT NULL,
     citation text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS media (
     id text PRIMARY KEY,
     kind text NOT NULL,
     item_type text NOT NULL,
     item_id text NOT NULL,
     filename text NOT NULL,
     bytes integer NOT NULL,
     content_type text NOT NULL,
     object_key text NOT NULL,
     transcript text,
     caption text,
     ordinal integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS media_item_idx ON media(item_id)`,
  `CREATE TABLE IF NOT EXISTS guided_sessions (
     id text PRIMARY KEY,
     title text NOT NULL,
     starts_at timestamptz NOT NULL,
     duration_minutes integer NOT NULL,
     capacity integer NOT NULL,
     cancelled_at timestamptz,
     cancel_reason text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id text PRIMARY KEY,
     session_id text NOT NULL REFERENCES guided_sessions(id),
     user_id text NOT NULL,
     seats integer NOT NULL,
     ticket_code text NOT NULL,
     state text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS bookings_session_idx ON bookings(session_id)`,
  `CREATE SEQUENCE IF NOT EXISTS receipt_number_seq AS bigint START 1`,
  `CREATE TABLE IF NOT EXISTS orders (
     id text PRIMARY KEY,
     receipt_number text UNIQUE NOT NULL,
     user_id text NOT NULL,
     user_email text NOT NULL,
     user_name text NOT NULL,
     kind text NOT NULL,
     description text NOT NULL,
     currency text NOT NULL,
     amount_minor bigint NOT NULL,
     settled_at timestamptz NOT NULL,
     card_last4 text NOT NULL,
     killbill_invoice_id text NOT NULL,
     killbill_payment_id text NOT NULL,
     booking_id text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id)`,
  `CREATE TABLE IF NOT EXISTS refunds (
     id text PRIMARY KEY,
     order_id text NOT NULL REFERENCES orders(id),
     amount_minor bigint NOT NULL,
     reason text NOT NULL,
     at timestamptz NOT NULL,
     killbill_refund_id text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds(order_id)`,
  `CREATE TABLE IF NOT EXISTS order_notes (
     id text PRIMARY KEY,
     order_id text NOT NULL REFERENCES orders(id),
     text text NOT NULL,
     author_email text NOT NULL,
     at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sign_in_sessions (
     id text PRIMARY KEY,
     user_id text NOT NULL,
     name text NOT NULL,
     email text NOT NULL,
     role text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency_records (
     user_id text NOT NULL,
     key text NOT NULL,
     method text NOT NULL,
     path text NOT NULL,
     body_hash text NOT NULL,
     state text NOT NULL,
     status integer,
     response_body jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS card_charge_counts (
     user_id text NOT NULL,
     card_class text NOT NULL,
     charges integer NOT NULL,
     PRIMARY KEY (user_id, card_class)
   )`,
  `CREATE TABLE IF NOT EXISTS mail_queue (
     id bigserial PRIMARY KEY,
     recipient_email text NOT NULL,
     recipient_name text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     state text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     sent_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS mail_queue_state_idx ON mail_queue(state)`,
  `CREATE TABLE IF NOT EXISTS killbill_accounts (
     user_id text PRIMARY KEY,
     kb_account_id text NOT NULL,
     currency text NOT NULL,
     email text NOT NULL,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS memberships (
     user_id text PRIMARY KEY,
     kb_account_id text NOT NULL,
     kb_subscription_id text NOT NULL,
     tier text NOT NULL,
     currency text NOT NULL,
     card_last4 text NOT NULL,
     card_class text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dunning_state (
     user_id text PRIMARY KEY,
     invoice_id text NOT NULL,
     order_kind text NOT NULL,
     amount_minor bigint NOT NULL,
     currency text NOT NULL,
     failed_at timestamptz NOT NULL,
     attempts integer NOT NULL,
     next_retry_at timestamptz,
     state text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS plan_price_changes (
     id bigserial PRIMARY KEY,
     tier text NOT NULL,
     currency text NOT NULL,
     amount_minor bigint NOT NULL,
     effective_on date NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     actor_email text NOT NULL,
     action text NOT NULL,
     target_type text NOT NULL,
     target_id text NOT NULL,
     detail jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  `CREATE TABLE IF NOT EXISTS deployment_state (
     key text PRIMARY KEY,
     value jsonb NOT NULL
   )`,
  `CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'audit_log is append-only';
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log`,
  `CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
     FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()`,
];
