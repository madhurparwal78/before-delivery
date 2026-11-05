import { pool } from './db.js';

let installed = false;

export async function ensureSchema(): Promise<void> {
  if (installed) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key text PRIMARY KEY,
        value text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS models (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        category text NOT NULL,
        state text NOT NULL DEFAULT 'draft',
        visibility text NOT NULL DEFAULT 'private',
        password_hash text,
        password_epoch integer NOT NULL DEFAULT 0,
        owner_id integer NOT NULL REFERENCES users(id),
        revision integer NOT NULL DEFAULT 0,
        revision_count integer NOT NULL DEFAULT 0,
        has_glb boolean NOT NULL DEFAULT false,
        has_stl boolean NOT NULL DEFAULT false,
        width_mm numeric NOT NULL DEFAULT 50,
        height_mm numeric NOT NULL DEFAULT 50,
        depth_mm numeric NOT NULL DEFAULT 50,
        bounding_radius_mm numeric NOT NULL DEFAULT 43.3,
        scale_denominator integer NOT NULL DEFAULT 1,
        cam_azimuth double precision NOT NULL DEFAULT 30,
        cam_tilt double precision NOT NULL DEFAULT 20,
        cam_distance_factor double precision NOT NULL DEFAULT 2.4,
        cam_fov double precision NOT NULL DEFAULT 35,
        hotspots jsonb NOT NULL DEFAULT '[]',
        price_personal_cents integer NOT NULL DEFAULT 1000,
        price_commercial_cents integer,
        price_studio_cents integer,
        discount_percent integer NOT NULL DEFAULT 0,
        edition_total integer,
        edition_price_cents integer,
        edition_sales integer NOT NULL DEFAULT 0,
        first_published_at timestamptz,
        publish_seq bigint,
        source_unit text NOT NULL DEFAULT 'mm',
        source_name text NOT NULL DEFAULT '',
        read_only boolean NOT NULL DEFAULT false,
        rebuilding boolean NOT NULL DEFAULT false,
        outdated boolean NOT NULL DEFAULT false,
        index_state text NOT NULL DEFAULT 'out',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS models_state_idx ON models (state);
      CREATE INDEX IF NOT EXISTS models_publish_seq_idx ON models (publish_seq);

      CREATE TABLE IF NOT EXISTS model_revisions (
        id serial PRIMARY KEY,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        revision_no integer NOT NULL,
        source_checksum text NOT NULL,
        source_name text NOT NULL,
        source_size integer NOT NULL,
        source_unit text NOT NULL,
        current boolean NOT NULL DEFAULT false,
        dims_set boolean NOT NULL DEFAULT false,
        width_mm numeric,
        height_mm numeric,
        depth_mm numeric,
        bounding_radius_mm numeric,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (model_id, revision_no)
      );

      CREATE TABLE IF NOT EXISTS uploads (
        ref text PRIMARY KEY,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        revision_id integer NOT NULL REFERENCES model_revisions(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'in_progress',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS upload_stages (
        upload_ref text NOT NULL REFERENCES uploads(ref) ON DELETE CASCADE,
        name text NOT NULL,
        idx integer NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        started_at timestamptz,
        confirmed_at timestamptz,
        PRIMARY KEY (upload_ref, name)
      );
      CREATE INDEX IF NOT EXISTS upload_stages_due_idx ON upload_stages (next_attempt_at);

      CREATE TABLE IF NOT EXISTS collections (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        collection_id integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        added_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection_id, model_id)
      );

      CREATE TABLE IF NOT EXISTS share_tokens (
        model_id integer PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
        token text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS embeds (
        token text PRIMARY KEY,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id serial PRIMARY KEY,
        ref text NOT NULL UNIQUE,
        name text NOT NULL UNIQUE,
        key_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        active boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS orders (
        id serial PRIMARY KEY,
        order_ref text NOT NULL UNIQUE,
        receipt_token text NOT NULL UNIQUE,
        buyer_email text NOT NULL,
        model_id integer NOT NULL REFERENCES models(id),
        licence text NOT NULL,
        seats integer NOT NULL,
        amount_cents integer NOT NULL,
        refunded_cents integer NOT NULL DEFAULT 0,
        refunded_seats integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending',
        edition_number integer,
        edition_total integer,
        locale text NOT NULL DEFAULT 'en',
        upgraded_to text,
        upgrade_from_id integer,
        kb_account_id text,
        kb_invoice_id text,
        kb_payment_id text,
        kb_payment_method_id text,
        kb_item_uuid text,
        idem_key text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_email);

      CREATE TABLE IF NOT EXISTS refunds (
        id serial PRIMARY KEY,
        order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        kind text NOT NULL,
        seats integer,
        amount_cents integer NOT NULL,
        external_key text NOT NULL,
        status text NOT NULL DEFAULT 'confirmed',
        kb_refund_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS edition_copies (
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        number integer NOT NULL,
        order_id integer,
        status text NOT NULL DEFAULT 'claimed',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (model_id, number)
      );

      CREATE TABLE IF NOT EXISTS idempotency_records (
        endpoint text NOT NULL,
        idem_key text NOT NULL,
        body_hash text NOT NULL,
        status integer,
        response_body bytea,
        content_type text,
        state text NOT NULL DEFAULT 'in_progress',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (endpoint, idem_key)
      );

      CREATE TABLE IF NOT EXISTS plan_state (
        id integer PRIMARY KEY DEFAULT 1,
        plan text NOT NULL DEFAULT 'free',
        billing_cycle_day integer NOT NULL DEFAULT 1,
        pending_plan text,
        pending_effective_date date,
        charged_cents integer,
        confirmed_at timestamptz,
        kb_account_id text,
        kb_subscription_id text,
        kb_bundle_id text,
        kb_payment_method_id text,
        last_seen_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS publish_events (
        id serial PRIMARY KEY,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE SEQUENCE IF NOT EXISTS model_publish_seq START 1;

      CREATE TABLE IF NOT EXISTS texture_sets (
        id serial PRIMARY KEY,
        ref text NOT NULL UNIQUE,
        model_id integer NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        name text NOT NULL,
        checksum text NOT NULL,
        images integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        key_id integer NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        bucket_second bigint NOT NULL,
        count integer NOT NULL,
        PRIMARY KEY (key_id, bucket_second)
      );

      CREATE TABLE IF NOT EXISTS pending_emails (
        id serial PRIMARY KEY,
        kind text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  } finally {
    client.release();
    installed = true;
  }
}

export async function getConfigValue(client: { query: (t: string, p?: unknown[]) => Promise<{ rows: { value: string }[] }> }, key: string): Promise<string | null> {
  const result = await client.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return result.rows[0]?.value ?? null;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  await pool.query(
    'INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value],
  );
}
