import postgres from "postgres";
import type { AppConfig } from "./config.js";

// Postgres is the system of record. Every scheduled or retried unit of work is
// claimed in the database, so several instances may share one database.
export type Sql = postgres.Sql<Record<string, unknown>>;

// jsonb columns may arrive as JSON text; normalise once, here.
export function asJson<T>(value: unknown): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return [] as unknown as T;
    }
  }
  return value as T;
}

export function createSql(config: AppConfig): Sql {
  return postgres(config.databaseUrl, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS newsrooms (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  home_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  newsroom_id integer REFERENCES newsrooms(id),
  contributor_handle text UNIQUE,
  payout_account text
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id integer NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clock_offsets (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  offset_ms bigint NOT NULL DEFAULT 0,
  seeded_at timestamptz
);

CREATE TABLE IF NOT EXISTS essays (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  caption text NOT NULL DEFAULT '',
  state text NOT NULL,
  lift_local text NOT NULL,
  lift_at timestamptz NOT NULL,
  lift_resolution text NOT NULL,
  exclusive_days integer NOT NULL,
  standard_days integer NOT NULL,
  exclusive_price_minor integer NOT NULL,
  standard_price_minor integer NOT NULL,
  submitted_at timestamptz,
  lifted_at timestamptz,
  withdrawal_requested boolean NOT NULL DEFAULT false,
  desk_notes jsonb NOT NULL DEFAULT '[]',
  created_by integer REFERENCES people(id),
  taken_down_at timestamptz,
  reference text
);

CREATE TABLE IF NOT EXISTS frames (
  id text PRIMARY KEY,
  essay_id text NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  position integer NOT NULL,
  caption text NOT NULL DEFAULT '',
  filename text NOT NULL,
  bytes integer NOT NULL,
  type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  UNIQUE (essay_id, position)
);

CREATE TABLE IF NOT EXISTS credits (
  essay_id text NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  person_id integer NOT NULL REFERENCES people(id),
  handle text NOT NULL,
  position integer NOT NULL,
  split_bp integer NOT NULL,
  PRIMARY KEY (essay_id, person_id)
);

CREATE TABLE IF NOT EXISTS follows (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  person_id integer NOT NULL REFERENCES people(id),
  essay_id text REFERENCES essays(id) ON DELETE CASCADE,
  followed_handle text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shortlist_items (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  newsroom_id integer NOT NULL REFERENCES newsrooms(id),
  frame_id text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  essay_id text NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  added_by integer NOT NULL REFERENCES people(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (newsroom_id, frame_id)
);

CREATE TABLE IF NOT EXISTS commission_rates (
  effective_from date NOT NULL,
  rate_bp integer NOT NULL,
  PRIMARY KEY (effective_from)
);

CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY,
  essay_id text NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  newsroom_id integer NOT NULL REFERENCES newsrooms(id),
  licensed_by integer NOT NULL REFERENCES people(id),
  kind text NOT NULL,
  state text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  confirmed_epoch_ms bigint NOT NULL,
  window_start bigint NOT NULL,
  window_end bigint NOT NULL,
  hold_until bigint NOT NULL,
  amount_minor integer NOT NULL,
  rate_bp integer NOT NULL,
  invoice_state text NOT NULL DEFAULT 'pending',
  receipt_state text,
  expiry_warning_queued_at timestamptz,
  activation_next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS licences_one_exclusive_per_essay
  ON licences (essay_id) WHERE kind = 'exclusive' AND state IN ('pending_invoice','active');

CREATE UNIQUE INDEX IF NOT EXISTS licences_one_per_newsroom
  ON licences (essay_id, newsroom_id) WHERE state IN ('pending_invoice','active');

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id integer NOT NULL REFERENCES people(id),
  key text NOT NULL,
  essay_id text,
  kind text,
  status integer,
  body jsonb,
  in_flight boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS royalty_statements (
  month text PRIMARY KEY,
  lines jsonb NOT NULL,
  totals jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payouts (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  month text NOT NULL REFERENCES royalty_statements(month),
  handle text NOT NULL,
  person_id integer NOT NULL REFERENCES people(id),
  amount_minor integer NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  next_attempt_at timestamptz,
  UNIQUE (month, handle)
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  subject_ascii boolean NOT NULL,
  body text NOT NULL,
  essay_id text,
  licence_id text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  sent_at timestamptz,
  UNIQUE (kind, to_email, licence_id)
);

CREATE TABLE IF NOT EXISTS lift_alerts (
  essay_id text NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  person_id integer NOT NULL REFERENCES people(id),
  PRIMARY KEY (essay_id, person_id)
);
`;
