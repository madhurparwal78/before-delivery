import { PoolClient } from "pg";
import { Database } from "./database.js";

/**
 * Schema applied idempotently on every start (DP: Services/PostgreSQL).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS operators (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `
  CREATE TABLE IF NOT EXISTS console_sessions (
    token text PRIMARY KEY,
    operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `
  CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL,
    title text NOT NULL,
    credit_type text NOT NULL,
    credit_line text NOT NULL,
    role text NOT NULL,
    blurb text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    visibility text NOT NULL DEFAULT 'public',
    position integer NOT NULL,
    bed_threshold integer NOT NULL DEFAULT 0,
    pulse_threshold integer NOT NULL DEFAULT 25,
    lead_threshold integer NOT NULL DEFAULT 50,
    stinger_threshold integer NOT NULL DEFAULT 75,
    status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_key ON projects (slug)`,
  `
  CREATE TABLE IF NOT EXISTS stems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layer text NOT NULL,
    format text NOT NULL,
    bytes integer NOT NULL,
    duration_ms integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, layer)
  )`,
  `
  CREATE TABLE IF NOT EXISTS listening_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label text NOT NULL,
    token text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    regenerated_from uuid,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `
  CREATE TABLE IF NOT EXISTS enquiry_sequence (
    singleton boolean PRIMARY KEY DEFAULT true,
    last_number integer NOT NULL DEFAULT 0
  )`,
  `
  CREATE TABLE IF NOT EXISTS enquiries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference text NOT NULL UNIQUE,
    version integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'new',
    name text NOT NULL,
    email text NOT NULL,
    studio text NOT NULL,
    brief text NOT NULL,
    preferred_month text,
    project_slug text,
    attachment_id uuid,
    attachment_filename text,
    attachment_bytes integer,
    attachment_format text,
    received_at timestamptz NOT NULL DEFAULT now(),
    triage_notes text,
    fit_score integer,
    rate_floor_cents integer
  )`,
  `CREATE INDEX IF NOT EXISTS enquiries_status_idx ON enquiries (status)`,
  `
  CREATE TABLE IF NOT EXISTS attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
    format text NOT NULL
  )`,
  `
  CREATE TABLE IF NOT EXISTS proposals (
    enquiry_id uuid PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    producer_name text NOT NULL,
    producer_email text NOT NULL,
    project_title text NOT NULL,
    scope text NOT NULL,
    fee_cents integer NOT NULL,
    production_month text NOT NULL,
    m1_cents integer NOT NULL,
    m2_cents integer NOT NULL,
    m3_cents integer NOT NULL,
    m4_cents integer NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    kb_account_id text,
    kb_deposit_invoice_id text,
    kb_deposit_invoice_number text,
    kb_deposit_item_date date,
    kb_deposit_amount_cents integer,
    payment_id text,
    paid_at timestamptz,
    production_started_at timestamptz,
    invoiced_milestones integer[] NOT NULL DEFAULT '{}',
    kb_milestone_invoice_ids text[] NOT NULL DEFAULT '{}',
    kb_milestone_invoice_numbers text[] NOT NULL DEFAULT '{}',
    kb_milestone_item_dates date[] NOT NULL DEFAULT '{}'
  )`,
  `
  CREATE TABLE IF NOT EXISTS production_months (
    month text PRIMARY KEY,
    capacity integer NOT NULL DEFAULT 0
  )`,
  `
  CREATE TABLE IF NOT EXISTS settings (
    singleton boolean PRIMARY KEY DEFAULT true,
    time_zone text NOT NULL,
    operator_email text NOT NULL
  )`,
  `
  CREATE TABLE IF NOT EXISTS brief_rate_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key text NOT NULL,
    policy text NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS brief_rate_events_key_idx ON brief_rate_events (key, saved_at)`,
  `
  CREATE TABLE IF NOT EXISTS idempotency_briefs (
    key text PRIMARY KEY,
    state text NOT NULL,
    fingerprint text NOT NULL,
    status integer NOT NULL,
    body jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `
  CREATE TABLE IF NOT EXISTS idempotency_deposits (
    key text PRIMARY KEY,
    proposal_enquiry_id uuid NOT NULL,
    state text NOT NULL,
    fingerprint text NOT NULL,
    status integer NOT NULL,
    body jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `
  CREATE TABLE IF NOT EXISTS mail_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enquiry_id uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
    kind text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    message text NOT NULL,
    recipient text NOT NULL,
    queued_at timestamptz NOT NULL DEFAULT now(),
    first_attempt_at timestamptz,
    retry_at timestamptz,
    sent_at timestamptz,
    cancelled_at timestamptz,
    claim_token text,
    claim_expires_at timestamptz,
    UNIQUE (enquiry_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS mail_queue_due_idx ON mail_queue (state, retry_at)`,
];

export async function applyMigrations(db: Database): Promise<void> {
  await db.transaction(async (client: PoolClient) => {
    for (const migration of MIGRATIONS) {
      await client.query(migration);
    }
  });
}
