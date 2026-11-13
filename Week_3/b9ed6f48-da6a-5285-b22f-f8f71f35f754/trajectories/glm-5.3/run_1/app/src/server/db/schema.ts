import type { PgPool } from '../db/pg.ts';

/** Schema and seed: applied idempotently on every start. */

export async function applySchema(pool: PgPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chapters (
      number integer PRIMARY KEY,
      title text NOT NULL,
      era text NOT NULL,
      body text NOT NULL,
      sightline_deg integer NOT NULL,
      exhibit text,
      owner_email text NOT NULL,
      status text NOT NULL DEFAULT 'published',
      publish_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id text PRIMARY KEY,
      citation text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      chapter integer NOT NULL REFERENCES chapters(number),
      year integer NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      owner_email text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      publish_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_sources (
      event_id text NOT NULL REFERENCES events(id),
      source_id text NOT NULL REFERENCES sources(id),
      PRIMARY KEY (event_id, source_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      id text PRIMARY KEY,
      kind text NOT NULL,
      item_id text NOT NULL,
      filename text NOT NULL,
      bytes integer NOT NULL,
      content_type text NOT NULL,
      storage_key text NOT NULL,
      transcript text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_item_idx ON media (item_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      title text NOT NULL,
      starts_at timestamptz NOT NULL,
      duration_minutes integer NOT NULL,
      capacity integer NOT NULL,
      status text NOT NULL DEFAULT 'on_sale',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES sessions(id),
      user_id text NOT NULL,
      seats integer NOT NULL,
      ticket_code text NOT NULL,
      live boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_session_idx ON bookings (session_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id text PRIMARY KEY,
      receipt_number text UNIQUE NOT NULL,
      kind text NOT NULL,
      user_id text NOT NULL,
      description text NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL,
      refunded_minor bigint NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'settled',
      settled_at timestamptz NOT NULL,
      card_last4 text NOT NULL,
      session_id text,
      ticket_code text,
      killbill_invoice_id text,
      killbill_payment_id text,
      killbill_account_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refunds (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id),
      amount_minor bigint NOT NULL,
      reason text NOT NULL,
      at timestamptz NOT NULL,
      killbill_refund_id text
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_notes (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id),
      text text NOT NULL,
      author_email text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signins (
      token text PRIMARY KEY,
      user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS signins_user_idx ON signins (user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency (
      user_id text NOT NULL,
      key text NOT NULL,
      method text NOT NULL,
      path text NOT NULL,
      body_hash text NOT NULL,
      status integer NOT NULL,
      response_body text,
      state text NOT NULL DEFAULT 'pending',
      in_flight boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_state (
      user_id text PRIMARY KEY,
      outcome_class text NOT NULL,
      last4 text NOT NULL,
      charge_count_0341 integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_accounts (
      user_id text PRIMARY KEY,
      account_id text NOT NULL,
      currency text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_queue (
      id text PRIMARY KEY,
      to_email text NOT NULL,
      to_name text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      dedupe_key text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dunning (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      order_id text NOT NULL,
      killbill_invoice_id text NOT NULL,
      killbill_payment_id text NOT NULL,
      tier text NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL,
      charge_kind text NOT NULL,
      attempts integer NOT NULL DEFAULT 1,
      failed_at timestamptz NOT NULL,
      next_retry_at timestamptz,
      cancelled boolean NOT NULL DEFAULT false,
      settled_order_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS dunning_user_idx ON dunning (user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      user_id text PRIMARY KEY,
      tier text NOT NULL,
      subscription_id text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      actor_email text NOT NULL,
      action text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      detail jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS price_changes (
      id text PRIMARY KEY,
      tier text NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL,
      effective_on date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS price_changes_tier_idx ON price_changes (tier, currency, effective_on)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_sequence (
      id integer PRIMARY KEY,
      value integer NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seed_state (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
