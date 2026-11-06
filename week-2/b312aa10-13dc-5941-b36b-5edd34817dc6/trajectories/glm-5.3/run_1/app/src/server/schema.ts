import type { PoolClient } from 'pg';

/**
 * The schema is applied idempotently every time the server starts.
 */
export async function applySchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS kitchens (
      id text PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL,
      time_zone text NOT NULL,
      rules_version integer NOT NULL DEFAULT 1,
      peak_windows jsonb NOT NULL DEFAULT '[]',
      required_documents text[] NOT NULL DEFAULT '{}',
      first_start_date date,
      first_start_instant timestamptz,
      seeded boolean NOT NULL DEFAULT false,
      accounts_ensured boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS people (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL,
      kitchen_id text NOT NULL REFERENCES kitchens(id),
      member_id text UNIQUE
    );
    CREATE TABLE IF NOT EXISTS members (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL REFERENCES kitchens(id),
      person_id text UNIQUE REFERENCES people(id),
      business_name text NOT NULL,
      allowance_hours integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      person_id text NOT NULL REFERENCES people(id),
      kitchen_id text NOT NULL REFERENCES kitchens(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS signin_failures (
      email_norm text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_signin_failures_email_at ON signin_failures (email_norm, at);
    CREATE TABLE IF NOT EXISTS stations (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL REFERENCES kitchens(id),
      name text NOT NULL,
      kind text NOT NULL,
      capacity integer,
      lane_order integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_versions (
      id text PRIMARY KEY,
      station_id text NOT NULL REFERENCES stations(id),
      effective_from_local text NOT NULL,
      effective_at timestamptz NOT NULL,
      off_peak_cents integer,
      peak_cents integer,
      shelf_day_cents integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (station_id, effective_at)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL REFERENCES kitchens(id),
      member_id text NOT NULL REFERENCES members(id),
      station_id text NOT NULL REFERENCES stations(id),
      kind text NOT NULL,
      local_date date NOT NULL,
      local_start text,
      local_end text,
      days integer,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      status text NOT NULL,
      series_id text,
      notes text NOT NULL DEFAULT '',
      hold_expires_at timestamptz,
      confirmed_at timestamptz,
      charge_cents integer NOT NULL DEFAULT 0,
      penalty_cents integer NOT NULL DEFAULT 0,
      penalty_waived boolean NOT NULL DEFAULT false,
      conflict boolean NOT NULL DEFAULT false,
      version integer NOT NULL DEFAULT 1,
      hours numeric NOT NULL DEFAULT 0,
      peak_hours numeric NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_station_time ON bookings (station_id, start_at, end_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_member ON bookings (member_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
    CREATE TABLE IF NOT EXISTS out_of_service_windows (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      station_id text NOT NULL REFERENCES stations(id),
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      local_date date NOT NULL,
      local_start text NOT NULL,
      local_end text NOT NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_oos_station_time ON out_of_service_windows (station_id, start_at, end_at);
    CREATE TABLE IF NOT EXISTS hour_ledger (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      member_id text NOT NULL,
      month text NOT NULL,
      hours numeric NOT NULL,
      booking_id text NOT NULL,
      kind text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hour_ledger_member_month ON hour_ledger (member_id, month);
    CREATE TABLE IF NOT EXISTS kb_items (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      member_id text NOT NULL,
      month text NOT NULL,
      kind text NOT NULL,
      booking_id text,
      description text NOT NULL,
      amount_cents integer NOT NULL,
      recorded boolean NOT NULL DEFAULT false,
      recorded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kb_items_member_month ON kb_items (member_id, month);
    CREATE TABLE IF NOT EXISTS idempotency (
      person_id text NOT NULL,
      key text NOT NULL,
      method text NOT NULL,
      path text NOT NULL,
      body_fingerprint text NOT NULL,
      status integer NOT NULL,
      response_body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (person_id, key)
    );
    CREATE TABLE IF NOT EXISTS documents (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      member_id text NOT NULL REFERENCES members(id),
      type text NOT NULL,
      expiry_date date NOT NULL,
      status text NOT NULL DEFAULT 'submitted',
      file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      version integer NOT NULL DEFAULT 1,
      superseded boolean NOT NULL DEFAULT false,
      seed boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_documents_member ON documents (member_id, type);
    CREATE TABLE IF NOT EXISTS expiry_notices (
      document_id text NOT NULL REFERENCES documents(id),
      kind text NOT NULL,
      PRIMARY KEY (document_id, kind)
    );
    CREATE TABLE IF NOT EXISTS sanitation_entries (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      area text NOT NULL,
      task text NOT NULL,
      sanitizer_ppm integer,
      initials text NOT NULL,
      notes text NOT NULL DEFAULT '',
      logged_at timestamptz NOT NULL DEFAULT now(),
      logged_by text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sanitation_reports (
      kitchen_id text NOT NULL,
      month text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      stored_at timestamptz,
      requested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kitchen_id, month)
    );
    CREATE TABLE IF NOT EXISTS inspector_links (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      email text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      active_token text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inspector_tokens (
      token text PRIMARY KEY,
      link_id text NOT NULL REFERENCES inspector_links(id),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS inspector_access (
      id text PRIMARY KEY,
      link_id text NOT NULL REFERENCES inspector_links(id),
      at timestamptz NOT NULL DEFAULT now(),
      action text NOT NULL,
      target text,
      seq bigint GENERATED ALWAYS AS IDENTITY
    );
    CREATE INDEX IF NOT EXISTS idx_inspector_access_link ON inspector_access (link_id, seq);
    CREATE TABLE IF NOT EXISTS invoice_state (
      kitchen_id text NOT NULL,
      month text NOT NULL,
      closed boolean NOT NULL DEFAULT false,
      closed_at timestamptz,
      PRIMARY KEY (kitchen_id, month)
    );
    CREATE TABLE IF NOT EXISTS close_names (
      kitchen_id text NOT NULL,
      month text NOT NULL,
      member_id text NOT NULL,
      business_name text NOT NULL,
      PRIMARY KEY (kitchen_id, month, member_id)
    );
    CREATE TABLE IF NOT EXISTS committed_invoices (
      id text PRIMARY KEY,
      kitchen_id text NOT NULL,
      member_id text NOT NULL,
      month text NOT NULL,
      kb_invoice_id text NOT NULL,
      amount_cents integer NOT NULL,
      committed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS frozen_figures (
      kitchen_id text NOT NULL,
      month text NOT NULL,
      kind text NOT NULL,
      payload text NOT NULL,
      PRIMARY KEY (kitchen_id, month, kind)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id text PRIMARY KEY,
      kind text NOT NULL,
      payload jsonb NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      done boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (done, next_attempt_at);
    CREATE TABLE IF NOT EXISTS kb_accounts (
      member_id text PRIMARY KEY,
      kb_account_id text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seed_objects_pending (
      document_id text PRIMARY KEY
    );
  `);
}
