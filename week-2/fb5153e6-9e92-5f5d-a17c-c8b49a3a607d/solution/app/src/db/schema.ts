import { query } from './pool.js';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS app_secrets (
     name text PRIMARY KEY,
     value text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS users (
     id serial PRIMARY KEY,
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     role text NOT NULL,
     password_hash text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id text PRIMARY KEY,
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS models (
     id serial PRIMARY KEY,
     slug text NOT NULL UNIQUE,
     title text NOT NULL,
     description text NOT NULL DEFAULT '',
     category text NOT NULL,
     state text NOT NULL,
     visibility text NOT NULL,
     owner_user_id integer NOT NULL REFERENCES users(id),
     password_hash text,
     share_token text UNIQUE,
     unlock_epoch integer NOT NULL DEFAULT 1,
     personal_cents integer NOT NULL,
     commercial_cents integer,
     studio_cents integer,
     discount_percent integer NOT NULL DEFAULT 0,
     edition_total integer,
     edition_price_cents integer,
     scale_denominator integer NOT NULL DEFAULT 1,
     formats text[] NOT NULL DEFAULT ARRAY['glb','stl']::text[],
     width_mm numeric(12,1) NOT NULL DEFAULT 0,
     height_mm numeric(12,1) NOT NULL DEFAULT 0,
     depth_mm numeric(12,1) NOT NULL DEFAULT 0,
     bounding_radius_mm numeric(12,1) NOT NULL DEFAULT 0,
     default_camera jsonb NOT NULL DEFAULT '{"azimuth":30,"tilt":20,"distance":2.4,"fov":35}'::jsonb,
     hotspots jsonb NOT NULL DEFAULT '[]'::jsonb,
     first_published_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS revisions (
     id serial PRIMARY KEY,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     revision integer NOT NULL,
     original_sha256 text NOT NULL,
     original_filename text NOT NULL,
     original_bytes bigint NOT NULL,
     source_unit text NOT NULL,
     package_kind text NOT NULL,
     width_mm numeric(12,1),
     height_mm numeric(12,1),
     depth_mm numeric(12,1),
     bounding_radius_mm numeric(12,1),
     published_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (model_id, revision)
   )`,

  `CREATE TABLE IF NOT EXISTS derivatives (
     id serial PRIMARY KEY,
     revision_id integer NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
     kind text NOT NULL,
     object_key text NOT NULL,
     bytes bigint NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (revision_id, kind)
   )`,

  `CREATE TABLE IF NOT EXISTS uploads (
     id serial PRIMARY KEY,
     upload_ref text NOT NULL UNIQUE,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     revision_id integer NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
     status text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS upload_stages (
     id serial PRIMARY KEY,
     upload_id integer NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
     name text NOT NULL,
     position integer NOT NULL,
     status text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     next_attempt_at timestamptz,
     failure text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (upload_id, name)
   )`,

  `CREATE TABLE IF NOT EXISTS collections (
     id serial PRIMARY KEY,
     slug text NOT NULL UNIQUE,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS collection_items (
     collection_id integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     added_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (collection_id, model_id)
   )`,

  `CREATE TABLE IF NOT EXISTS orders (
     id serial PRIMARY KEY,
     order_ref text NOT NULL UNIQUE,
     receipt_token text NOT NULL UNIQUE,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     email text NOT NULL,
     licence text NOT NULL,
     seats integer NOT NULL,
     amount_cents integer NOT NULL,
     refunded_cents integer NOT NULL DEFAULT 0,
     refunded_seats integer NOT NULL DEFAULT 0,
     edition_number integer,
     locale text NOT NULL,
     upgraded_to text,
     upgrade_from_order_id integer REFERENCES orders(id),
     killbill_account_id text,
     killbill_invoice_id text,
     killbill_payment_id text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS refunds (
     id serial PRIMARY KEY,
     order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
     kind text NOT NULL,
     seats integer,
     amount_cents integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS edition_copies (
     id serial PRIMARY KEY,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     number integer NOT NULL,
     order_id integer REFERENCES orders(id) ON DELETE SET NULL,
     retired boolean NOT NULL DEFAULT false,
     claimed_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (model_id, number)
   )`,

  `CREATE TABLE IF NOT EXISTS idempotency (
     id serial PRIMARY KEY,
     endpoint text NOT NULL,
     key text NOT NULL,
     body_hash text NOT NULL,
     status integer,
     response_body text,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (endpoint, key)
   )`,

  `CREATE TABLE IF NOT EXISTS embeds (
     id serial PRIMARY KEY,
     token text NOT NULL UNIQUE,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS read_keys (
     id serial PRIMARY KEY,
     key_ref text NOT NULL UNIQUE,
     name text NOT NULL,
     key_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     revoked_at timestamptz
   )`,

  `CREATE TABLE IF NOT EXISTS plan_state (
     id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     active_plan text,
     pending_plan text,
     pending_effective_date date,
     billing_cycle_day integer,
     confirmed_at timestamptz,
     killbill_account_id text,
     killbill_subscription_id text
   )`,

  `CREATE TABLE IF NOT EXISTS publish_events (
     id serial PRIMARY KEY,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     published_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS texture_sets (
     id serial PRIMARY KEY,
     ref text NOT NULL UNIQUE,
     model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     name text NOT NULL,
     sha256 text NOT NULL,
     images integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS mail_outbox (
     id serial PRIMARY KEY,
     dedupe_key text NOT NULL UNIQUE,
     to_email text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     status text NOT NULL DEFAULT 'pending',
     attempts integer NOT NULL DEFAULT 0,
     next_attempt_at timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS search_removals (
     slug text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS search_writes (
     slug text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS models_state_idx ON models (state)`,
  `CREATE INDEX IF NOT EXISTS models_owner_idx ON models (owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS revisions_model_idx ON revisions (model_id, revision DESC)`,
  `CREATE INDEX IF NOT EXISTS uploads_model_idx ON uploads (model_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(email))`,
  `CREATE INDEX IF NOT EXISTS stages_pending_idx ON upload_stages (status, next_attempt_at)`,
];

export async function ensureSchema(): Promise<void> {
  for (const statement of STATEMENTS) await query(statement);
  await query(
    `INSERT INTO plan_state (id, active_plan) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING`,
  );
}
